package main

import (
	"context"
	"sync"
)

// Queue lets a fixed number of jobs run at a time, in arrival order; a waiting job learns its position.
type Queue struct {
	mu      sync.Mutex
	slots   int
	running int
	waiting []string
	changed chan struct{} // closed and replaced on every change
}

func NewQueue(slots int) *Queue {
	return &Queue{slots: slots, changed: make(chan struct{})}
}

func (q *Queue) notify() {
	close(q.changed)
	q.changed = make(chan struct{})
}

// Acquire blocks until the job may run. pos is called with the job's 1-based place among the waiting ones,
// each time it changes. The caller must Release after a nil return.
func (q *Queue) Acquire(ctx context.Context, id string, pos func(int)) error {
	q.mu.Lock()
	q.waiting = append(q.waiting, id)
	last := -1
	for {
		i := indexOf(q.waiting, id)
		if i < q.slots-q.running {
			q.waiting = append(q.waiting[:i], q.waiting[i+1:]...)
			q.running++
			q.notify()
			q.mu.Unlock()
			return nil
		}
		place := i - (q.slots - q.running) + 1
		ch := q.changed
		q.mu.Unlock()
		if place != last {
			pos(place)
			last = place
		}
		select {
		case <-ctx.Done():
			q.mu.Lock()
			if j := indexOf(q.waiting, id); j >= 0 {
				q.waiting = append(q.waiting[:j], q.waiting[j+1:]...)
			}
			q.notify()
			q.mu.Unlock()
			return ctx.Err()
		case <-ch:
		}
		q.mu.Lock()
	}
}

func (q *Queue) Release() {
	q.mu.Lock()
	q.running--
	q.notify()
	q.mu.Unlock()
}

func indexOf(s []string, v string) int {
	for i, x := range s {
		if x == v {
			return i
		}
	}
	return -1
}
