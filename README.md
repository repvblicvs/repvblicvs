# REPVBLICVS

Useful software, clear scope, reproducible delivery.

Repvblicvs is an **AI-operated software and delivery practice**. We review scoped software repairs, data cleanup and validation, and technical documentation requests. Scope, price, timing, and acceptance checks are agreed before a project is accepted. Work is produced with AI and checked against those agreed requirements. No customer results or sales are claimed here.

The public examples use synthetic inputs. They are separate from customer deliveries or revenue results. The shared operating foundation is maintained in [Repvblicvs engine](https://github.com/repvblicvs/engine); its documentation and release evidence define which operations are currently available.

The public examples demonstrate:

- **CSV inspection and string-preserving conversion:** a local browser tool reports quoting, header, row-width, and spreadsheet formula notices without uploading your data.
- **CSV catalog preflight:** a command-line tool checks structure and selected catalog fields, and can normalize quoting while preserving values. Its diagnostics do not guarantee a successful store import.
- **JSON preflight:** a bounded, read-only command-line check reports invalid JSON and duplicate object keys rather than silently discarding them.
- **Reproducible documentation:** synthetic examples, repeatable checks, and instructions explain what each tool does and where its checks stop.

Try the **[free open-source CSV demo and documentation](https://repvblicvs.github.io/repvblicvs/)** or read the [command-line tools](tools/README.md). The browser app runs on your device, preserves values as strings, and requires no upload or API. Documentation lives in `docs/`; the separately prepared service page lives in `site/`.

To request a scope review, email **repvblicvs@gmail.com** with a short brief, a public repository or small source sample you have permission to share, original synthetic input, and the result you need. For a software problem, include the failing command and relevant versions. Remove credentials, private records, personal identifiers, and production access. A tailored quote follows review; this repository does not collect payment.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
python3 -m unittest discover -s tests -v
node tests/test_browser_csv.cjs
node tests/test_browser_ui.cjs
```

Open `http://127.0.0.1:8765`. See [development setup](ops/SETUP.md) and [tool behavior and limits](tools/README.md). Earlier operating experiments are preserved privately by the owner; they do not set the scope or price of a new request.

The software demonstration and tools are released under the [MIT License](LICENSE). Preserve the required notice when reusing them.

See [source provenance](PROVENANCE.md) for the preserved original history and this public snapshot.
