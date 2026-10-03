# Command-line data checks

The repository includes a CSV catalog triage tool, documented below, and [JSON syntax and duplicate-key preflight](JSON_PREFLIGHT.md). Both run locally with the Python standard library.

## Catalog CSV triage

This original, standard-library Python tool runs locally. It checks CSV structure and a small set of catalog conditions, then optionally writes a new file with normalized UTF-8 encoding, CSV quoting, and LF record separators. Parsed cell values—including whitespace, leading-zero SKUs, and embedded description newlines—stay unchanged. No store, account, or network access occurs when the tool runs.

Run from the repository root with Python 3.11 or later:

```sh
python3 tools/catalog_csv.py examples/catalog-current.csv --variants
python3 tools/catalog_csv.py examples/catalog-current.csv --variants --report /tmp/catalog-report.json --normalize /tmp/catalog-normalized.csv
python3 -m unittest discover -s tests -v
```

Output paths must be new and distinct from the input, and all parent directories must already exist. Existing files are never overwritten. If an output write fails, the command removes files it created whose file identities still match; it leaves detected external replacements alone and reports any cleanup failure. The JSON report defaults to stdout. Exit status is `0` when no local errors or requested-export blockers were found, `1` for detected errors or a withheld export, and `2` for command or file errors. Warnings alone do not imply an error exit.

The default profile uses Shopify's **current** headers: `Title`, `URL handle`, `SKU`, and `Price`. Use `--header-style legacy` explicitly for `Handle`, `Variant SKU`, and `Variant Price`; the tool never renames headers. `--mode create` requires the `Title` header; `--variants` additionally requires a handle. `--mode update` requires Title and a handle; inclusion of SKU or weight also checks the documented Option1 name/value dependency. The tool does not require Title on every variant row.

Duplicate or empty headers, wrong row widths, malformed quoting, invalid UTF-8, NULs, files over 10 MiB, and more than 100,000 data rows prevent normalization. Nonempty prices outside the tool's conservative unsigned-decimal grammar are reported. Blank prices and repeated nonempty SKUs are warnings. No price, identifier, title, or other business value is repaired or invented.

Formatting may still be exported when catalog errors are present, because values are preserved. This export is **not** a corrected or approved import file. Review the report first. Formula-like cells (including headers) are flagged, and normalization is withheld unless `--allow-formula-like` explicitly acknowledges the risk. That option preserves the cell unchanged; it does not make opening it in spreadsheet software safe.

Examples contain invented products and identifiers. `catalog-review.csv` deliberately has prices and SKUs needing review, plus a harmless formula-like demonstration. Reports identify cell locations without copying customer values into diagnostic messages.

Shopify header names and conditional requirements were checked against the [official product CSV documentation](https://help.shopify.com/en/manual/products/import-export/using-csv) on October 1, 2026. The tool does not validate every Shopify field or dependency, store state, inventory locations, image URLs, taxonomy, taxes, variant identity, or the consequences of overwriting existing products. A local result is not a successful store import.
