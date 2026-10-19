package lru

import "testing"

func TestLRU(t *testing.T) {
	c, err := New[string, int](2)
	if err != nil {
		t.Fatal(err)
	}
	c.Add("a", 1)
	c.Add("b", 2)
	if v, ok := c.Get("a"); !ok || v != 1 {
		t.Fatal("get a")
	}
	if !c.Add("c", 3) { // evicts b (a was used more recently)
		t.Fatal("expected eviction")
	}
	if _, ok := c.Get("b"); ok {
		t.Fatal("b should be evicted")
	}
	if c.Len() != 2 {
		t.Fatal("len")
	}
	if _, err := New[int, int](0); err == nil {
		t.Fatal("size 0 accepted")
	}
}
