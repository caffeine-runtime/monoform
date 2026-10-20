package capture

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

// callTimeout bounds starting a portal request (not the user's answer).
var callTimeout = 10 * time.Second

// portalScreenshot asks the desktop's screenshot portal for a shot (the
// desktop shows its own UI when interactive) and returns the file URI.
func portalScreenshot(ctx context.Context, interactive bool) (string, error) {
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		// Don't let the D-Bus library start a bus of its own.
		if _, err := os.Stat(filepath.Join(os.Getenv("XDG_RUNTIME_DIR"), "bus")); os.Getenv("XDG_RUNTIME_DIR") == "" || err != nil {
			return "", ErrUnavailable
		}
	}
	conn, err := dbus.ConnectSessionBus(dbus.WithContext(ctx))
	if err != nil {
		return "", err
	}
	defer conn.Close()
	token := fmt.Sprintf("hia%d", time.Now().UnixNano())
	names := conn.Names()
	if len(names) == 0 {
		return "", errors.New("no D-Bus name")
	}
	sender := strings.ReplaceAll(strings.TrimPrefix(names[0], ":"), ".", "_")
	want := dbus.ObjectPath(fmt.Sprintf("/org/freedesktop/portal/desktop/request/%s/%s", sender, token))
	ch := make(chan *dbus.Signal, 8)
	conn.Signal(ch)
	match := func(p dbus.ObjectPath) error {
		return conn.AddMatchSignal(dbus.WithMatchObjectPath(p), dbus.WithMatchInterface("org.freedesktop.portal.Request"), dbus.WithMatchMember("Response"))
	}
	// Subscribe before calling, so a quick answer isn't missed.
	if err := match(want); err != nil {
		return "", err
	}
	var handle dbus.ObjectPath
	obj := conn.Object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")
	opts := map[string]dbus.Variant{"handle_token": dbus.MakeVariant(token), "interactive": dbus.MakeVariant(interactive), "modal": dbus.MakeVariant(true)}
	// The call itself only starts the request: a portal that doesn't take it
	// within seconds (none running, or no desktop to answer) won't answer at all.
	cctx, cancel := context.WithTimeout(ctx, callTimeout)
	err = obj.CallWithContext(cctx, "org.freedesktop.portal.Screenshot.Screenshot", 0, "", opts).Store(&handle)
	cancel()
	if err != nil {
		return "", err
	}
	if handle != want {
		if err := match(handle); err != nil { // older portals ignore handle_token
			return "", err
		}
	}
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case s := <-ch:
			if s == nil || s.Path != handle || s.Name != "org.freedesktop.portal.Request.Response" || len(s.Body) < 2 {
				continue
			}
			code, _ := s.Body[0].(uint32)
			switch code {
			case 0:
			case 1:
				return "", ErrCancelled
			default:
				return "", errors.New("the desktop refused the screenshot")
			}
			results, _ := s.Body[1].(map[string]dbus.Variant)
			uri, _ := results["uri"].Value().(string)
			if uri == "" {
				return "", errors.New("the screenshot portal returned no file")
			}
			return uri, nil
		}
	}
}
