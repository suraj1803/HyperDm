use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};

use crate::engine::models::{SegmentSnapshot, SegmentStatus};

#[derive(Debug)]
struct SegmentBounds {
    /// Inclusive upper bound of this segment. May only shrink monotonically on dynamic split.
    end: u64,
    /// Bytes reserved by the worker for in-flight disk writes (always >= downloaded).
    reserved: u64,
    /// Bytes durably written to disk starting at `start`.
    downloaded: u64,
    status: SegmentStatus,
}

/// Thread-safe live segment supporting lock-free speed tracking and race-free
/// dynamic work-stealing bisection (IDM-style dynamic file segmentation).
#[derive(Debug)]
pub struct LiveSegment {
    pub id: u32,
    pub start: u64,
    bounds: Mutex<SegmentBounds>,
    pub speed_bps: AtomicU64,
    pub retries: AtomicU32,
}

impl LiveSegment {
    pub fn new(id: u32, start: u64, end: u64) -> Self {
        Self {
            id,
            start,
            bounds: Mutex::new(SegmentBounds {
                end,
                reserved: 0,
                downloaded: 0,
                status: SegmentStatus::Pending,
            }),
            speed_bps: AtomicU64::new(0),
            retries: AtomicU32::new(0),
        }
    }

    pub fn from_snapshot(snap: &SegmentSnapshot) -> Self {
        let status = match snap.status {
            SegmentStatus::Completed => SegmentStatus::Completed,
            _ => SegmentStatus::Pending,
        };
        Self {
            id: snap.id,
            start: snap.start,
            bounds: Mutex::new(SegmentBounds {
                end: snap.end,
                reserved: snap.downloaded,
                downloaded: snap.downloaded,
                status,
            }),
            speed_bps: AtomicU64::new(0),
            retries: AtomicU32::new(snap.retries),
        }
    }

    pub fn set_status(&self, status: SegmentStatus) {
        let mut b = self.bounds.lock().unwrap();
        b.status = status;
    }

    pub fn status(&self) -> SegmentStatus {
        self.bounds.lock().unwrap().status
    }

    /// Returns `(next_byte_offset, inclusive_end)` for issuing or resuming an HTTP Range request.
    /// Returns `None` if the segment is already complete.
    pub fn next_range(&self) -> Option<(u64, u64)> {
        let b = self.bounds.lock().unwrap();
        let next_pos = self.start + b.downloaded;
        if next_pos > b.end {
            None
        } else {
            Some((next_pos, b.end))
        }
    }

    /// Reserves up to `requested_len` bytes for writing at the current offset.
    /// Returns `Some((write_offset, allowed_len))` or `None` if the segment has reached its `end`.
    /// This guarantees a concurrent dynamic split can never steal bytes already being written.
    pub fn reserve_write(&self, requested_len: u64) -> Option<(u64, u64)> {
        let mut b = self.bounds.lock().unwrap();
        let cursor = self.start + b.reserved;
        if cursor > b.end {
            return None;
        }
        let remaining = b.end - cursor + 1;
        let to_write = requested_len.min(remaining);
        if to_write == 0 {
            return None;
        }
        b.reserved += to_write;
        Some((cursor, to_write))
    }

    /// Marks `written_len` reserved bytes as durably written to disk.
    pub fn commit_write(&self, written_len: u64) {
        let mut b = self.bounds.lock().unwrap();
        b.downloaded += written_len;
    }

    /// Rolls back a reservation if disk write fails.
    pub fn rollback_write(&self, len: u64) {
        let mut b = self.bounds.lock().unwrap();
        b.reserved = b.reserved.saturating_sub(len);
    }

    /// For unknown-length single-stream downloads where `end == 0`.
    pub fn advance_unbounded(&self, written_len: u64) {
        let mut b = self.bounds.lock().unwrap();
        b.reserved += written_len;
        b.downloaded += written_len;
    }

    pub fn is_complete(&self) -> bool {
        let b = self.bounds.lock().unwrap();
        self.start + b.downloaded > b.end
    }

    pub fn downloaded_bytes(&self) -> u64 {
        self.bounds.lock().unwrap().downloaded
    }

    /// Remaining unreserved bytes in this segment.
    pub fn remaining_unreserved(&self) -> u64 {
        let b = self.bounds.lock().unwrap();
        if b.status == SegmentStatus::Completed {
            return 0;
        }
        let cursor = self.start + b.reserved;
        if cursor > b.end {
            0
        } else {
            b.end - cursor + 1
        }
    }

    /// Attempts to bisect the unreserved tail of this segment in half.
    /// If `remaining >= min_split_size`, shrinks `self.end` to `mid` and returns `(mid + 1, old_end)`.
    pub fn try_split(&self, min_split_size: u64) -> Option<(u64, u64)> {
        let mut b = self.bounds.lock().unwrap();
        if matches!(
            b.status,
            SegmentStatus::Completed | SegmentStatus::Paused | SegmentStatus::Error
        ) {
            return None;
        }
        let cursor = self.start + b.reserved;
        if cursor > b.end {
            return None;
        }
        let remaining = b.end - cursor + 1;
        let threshold = min_split_size.max(2);
        if remaining < threshold {
            return None;
        }

        let old_end = b.end;
        let half = remaining / 2;
        let mid = cursor + half - 1;
        debug_assert!(mid >= cursor && mid < old_end);

        b.end = mid;
        Some((mid + 1, old_end))
    }

    pub fn snapshot(&self) -> SegmentSnapshot {
        let b = self.bounds.lock().unwrap();
        SegmentSnapshot {
            id: self.id,
            start: self.start,
            end: b.end,
            downloaded: b.downloaded,
            speed_bps: self.speed_bps.load(Ordering::Relaxed),
            status: b.status,
            retries: self.retries.load(Ordering::Relaxed),
        }
    }
}

/// Finds the active segment with the largest remaining unreserved byte range and
/// splits it in half if `remaining >= min_split_size`.
pub fn try_split_largest_segment(
    segments: &[Arc<LiveSegment>],
    next_id: u32,
    min_split_size: u64,
) -> Option<Arc<LiveSegment>> {
    let candidate = segments
        .iter()
        .filter(|s| {
            matches!(
                s.status(),
                SegmentStatus::Downloading | SegmentStatus::Connecting | SegmentStatus::Pending
            )
        })
        .max_by_key(|s| s.remaining_unreserved())?;

    let (new_start, new_end) = candidate.try_split(min_split_size)?;
    Some(Arc::new(LiveSegment::new(next_id, new_start, new_end)))
}

/// Creates the initial segment partition for a file of `total_size` bytes.
pub fn build_initial_segments(
    total_size: u64,
    max_connections: u32,
    min_split_size: u64,
) -> Vec<Arc<LiveSegment>> {
    if total_size == 0 {
        return Vec::new();
    }

    let max_by_size = (total_size / min_split_size.max(1)).max(1);
    let count = (max_connections.max(1) as u64).min(max_by_size) as u32;
    let base_chunk = total_size / count as u64;

    let mut segments = Vec::with_capacity(count as usize);
    for i in 0..count {
        let start = i as u64 * base_chunk;
        let end = if i == count - 1 {
            total_size - 1
        } else {
            (i as u64 + 1) * base_chunk - 1
        };
        segments.push(Arc::new(LiveSegment::new(i + 1, start, end)));
    }
    segments
}
