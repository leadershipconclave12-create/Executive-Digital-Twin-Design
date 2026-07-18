package agent

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// OneDrive / SharePoint awareness — the files that already live on his machine
// because OneDrive synced them. No Graph, no API: these are folders on disk he
// can open right now. We just tell him what's there and what changed lately.

// SyncRoot is one synced location: personal OneDrive or a SharePoint/Teams
// document library that shows up as "OneDrive - <Org>" / "<Org>".
type SyncRoot struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Kind      string `json:"kind"` // personal | business | sharepoint
	FileCount int    `json:"fileCount"`
	RecentDoc string `json:"recentDoc,omitempty"`
	RecentAt  string `json:"recentAt,omitempty"`
}

// OneDrive is the composed picture of everything synced locally.
type OneDrive struct {
	Available bool       `json:"available"`
	Note      string     `json:"note,omitempty"`
	Roots     []SyncRoot `json:"roots"`
	Recent    []Doc      `json:"recent"` // most-recently-touched synced documents
	ReadAt    string     `json:"readAt"`
}

// syncRoots finds OneDrive-style folders in his home directory. OneDrive names
// its business roots "OneDrive - <Org>" and may create a top-level "<Org>"
// SharePoint mirror; personal is just "OneDrive".
func syncRoots(home string) []SyncRoot {
	var roots []SyncRoot
	entries, err := os.ReadDir(home)
	if err != nil {
		return roots
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		low := strings.ToLower(name)
		kind := ""
		switch {
		case low == "onedrive":
			kind = "personal"
		case strings.HasPrefix(low, "onedrive -"):
			kind = "business"
		}
		if kind == "" {
			continue
		}
		roots = append(roots, SyncRoot{Name: name, Path: filepath.Join(home, name), Kind: kind})
	}
	return roots
}

// ReadOneDrive lists his synced roots and the documents most recently touched
// inside them. Read-only; skips anything unreadable.
func ReadOneDrive(limit int) OneDrive {
	od := OneDrive{ReadAt: time.Now().UTC().Format(time.RFC3339)}
	home, err := os.UserHomeDir()
	if err != nil {
		od.Note = "Could not resolve the home directory."
		return od
	}
	roots := syncRoots(home)
	if len(roots) == 0 {
		od.Available = false
		od.Note = "No OneDrive sync folder found. Sign in to OneDrive and let it sync, then retry."
		return od
	}
	od.Available = true

	cutoff := time.Now().AddDate(0, -6, 0)
	var all []Doc
	for i := range roots {
		var count int
		var newestDoc Doc
		root := roots[i].Path
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				// keep it shallow and skip noise
				if strings.Count(p[len(root):], string(os.PathSeparator)) > 4 {
					return filepath.SkipDir
				}
				n := d.Name()
				if strings.HasPrefix(n, ".") || n == "node_modules" {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if !docExt[ext] {
				return nil
			}
			fi, e := d.Info()
			if e != nil {
				return nil
			}
			count++
			doc := Doc{Name: d.Name(), Path: p, Ext: ext, Size: fi.Size(),
				Modified: fi.ModTime().UTC().Format(time.RFC3339)}
			if newestDoc.Modified == "" || doc.Modified > newestDoc.Modified {
				newestDoc = doc
			}
			if !fi.ModTime().Before(cutoff) {
				all = append(all, doc)
			}
			return nil
		})
		roots[i].FileCount = count
		roots[i].RecentDoc = newestDoc.Name
		roots[i].RecentAt = newestDoc.Modified
	}
	od.Roots = roots

	sort.Slice(all, func(i, j int) bool { return all[i].Modified > all[j].Modified })
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	od.Recent = all
	return od
}
