# Development setup

The local tools use the Python standard library. Use Python 3.11 or later, Node.js for browser checks, and a modern browser. No account, API, or paid dependency is needed to run the demos.

```sh
git clone https://github.com/repvblicvs/repvblicvs.git
cd repvblicvs
git status --short --branch
git config user.name Repvblicvs
git config user.email 310353846+repvblicvs@users.noreply.github.com
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
python3 -m unittest discover -s tests -v
node tests/test_browser_csv.cjs
node tests/test_browser_ui.cjs
python3 ops/public_check.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:8765` for the service page, or serve `docs/` for the public documentation demo. Serve only those public directories. The server binds to this machine.

Before committing, stage explicit paths, review `git diff --cached`, and run `python3 ops/public_check.py --staged`. Configure identity in this repository only. Remote writes must select the intended GitHub account explicitly.

GitHub Pages serves `main:/docs`. Keep `docs/index.html`, `docs/app.js`, `docs/style.css`, and `docs/.nojekyll` together. The browser app uses local relative assets, with no analytics or remote runtime dependencies.
