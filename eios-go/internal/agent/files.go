package agent

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Local document awareness: what he's been working on. Read-only, his own
// folders, no indexing service, no upload — the twin just knows what exists.

type Doc struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Ext      string `json:"ext"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

var docExt = map[string]bool{
	".docx": true, ".doc": true, ".xlsx": true, ".xls": true, ".pptx": true,
	".ppt": true, ".pdf": true, ".msg": true, ".csv": true, ".txt": true, ".md": true,
}

// RecentDocs walks his usual folders and returns the most recently touched
// documents. Skips anything it can't read rather than failing the whole scan.
func RecentDocs(limit int) []Doc {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	roots := []string{
		filepath.Join(home, "Documents"),
		filepath.Join(home, "Desktop"),
		filepath.Join(home, "Downloads"),
	}
	// OneDrive-synced business folders, if present.
	if entries, err := os.ReadDir(home); err == nil {
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(e.Name(), "OneDrive") {
				roots = append(roots, filepath.Join(home, e.Name()))
			}
		}
	}

	var docs []Doc
	cutoff := time.Now().AddDate(0, -3, 0) // last 3 months is "recent" for an exec
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			continue
		}
		depth := 0
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // unreadable branch — skip, don't abort
			}
			if d.IsDir() {
				// keep the scan cheap; don't crawl the whole drive
				if strings.Count(p[len(root):], string(os.PathSeparator)) > 3 {
					return filepath.SkipDir
				}
				name := d.Name()
				if strings.HasPrefix(name, ".") || name == "node_modules" || name == "AppData" {
					return filepath.SkipDir
				}
				depth++
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if !docExt[ext] {
				return nil
			}
			fi, err := d.Info()
			if err != nil || fi.ModTime().Before(cutoff) {
				return nil
			}
			docs = append(docs, Doc{
				Name: d.Name(), Path: p, Ext: ext, Size: fi.Size(),
				Modified: fi.ModTime().UTC().Format(time.RFC3339),
			})
			return nil
		})
	}
	sort.Slice(docs, func(i, j int) bool { return docs[i].Modified > docs[j].Modified })
	if limit > 0 && len(docs) > limit {
		docs = docs[:limit]
	}
	return docs
}
