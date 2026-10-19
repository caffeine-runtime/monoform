// Package lru is a small, independently written LRU cache exposing the subset
// of the github.com/hashicorp/golang-lru/v2 API that github.com/bodgit/sevenzip
// uses (New, Get, Add). It replaces that module (MPL-2.0) via a go.mod
// replace directive so every linked dependency stays permissively licensed.
package lru

import (
	"container/list"
	"errors"
	"sync"
)

type entry[K comparable, V any] struct {
	key K
	val V
}

// Cache is a fixed-size, concurrency-safe least-recently-used cache.
type Cache[K comparable, V any] struct {
	mu    sync.Mutex
	size  int
	order *list.List // front = most recently used
	items map[K]*list.Element
}

// New creates a cache holding at most size entries.
func New[K comparable, V any](size int) (*Cache[K, V], error) {
	if size <= 0 {
		return nil, errors.New("lru: size must be positive")
	}
	return &Cache[K, V]{size: size, order: list.New(), items: make(map[K]*list.Element, size)}, nil
}

// Get returns the value for key and marks it recently used.
func (c *Cache[K, V]) Get(key K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.order.MoveToFront(el)
		return el.Value.(*entry[K, V]).val, true
	}
	var zero V
	return zero, false
}

// Add stores value under key and reports whether an entry was evicted.
func (c *Cache[K, V]) Add(key K, value V) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		el.Value.(*entry[K, V]).val = value
		c.order.MoveToFront(el)
		return false
	}
	c.items[key] = c.order.PushFront(&entry[K, V]{key, value})
	if c.order.Len() > c.size {
		last := c.order.Back()
		c.order.Remove(last)
		delete(c.items, last.Value.(*entry[K, V]).key)
		return true
	}
	return false
}

// Len returns the number of cached entries.
func (c *Cache[K, V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}
