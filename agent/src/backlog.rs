//! Summaries not sent yet (offline buffering). While the computer is offline, each minute's
//! summary waits here and the backlog is sent in batches when the connection is back
//! (`agent:pushSummaries`). Memory only: a restart loses the backlog, which is acceptable for
//! one-minute history. When full, the oldest entry makes room for the newest.

use std::collections::VecDeque;

pub struct Backlog<T> {
    items: VecDeque<T>,
    cap: usize,
}

impl<T: Clone> Backlog<T> {
    pub fn new(cap: usize) -> Self {
        Self {
            items: VecDeque::with_capacity(cap.min(64)),
            cap,
        }
    }

    /// Adds the newest entry. Returns true when the oldest had to be dropped to make room.
    pub fn push(&mut self, item: T) -> bool {
        let full = self.items.len() >= self.cap;
        if full {
            self.items.pop_front();
        }
        self.items.push_back(item);
        full
    }

    /// Up to `max` of the oldest entries; they stay until `confirm`.
    pub fn batch(&self, max: usize) -> Vec<T> {
        self.items.iter().take(max).cloned().collect()
    }

    /// Removes the `n` oldest entries once they were delivered.
    pub fn confirm(&mut self, n: usize) {
        self.items.drain(..n.min(self.items.len()));
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_order_and_drops_the_oldest_when_full() {
        let mut b = Backlog::new(3);
        assert!(!b.push(1));
        assert!(!b.push(2));
        assert!(!b.push(3));
        assert!(b.push(4)); // 1 is dropped
        assert_eq!(b.batch(10), vec![2, 3, 4]);
    }

    #[test]
    fn batch_keeps_entries_until_confirmed() {
        let mut b = Backlog::new(100);
        for i in 0..5 {
            b.push(i);
        }
        assert_eq!(b.batch(2), vec![0, 1]);
        assert_eq!(b.len(), 5); // a failed send loses nothing
        b.confirm(2);
        assert_eq!(b.batch(10), vec![2, 3, 4]);
        b.confirm(10);
        assert!(b.is_empty());
    }
}
