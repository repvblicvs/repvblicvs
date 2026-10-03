# JSON preflight

`json_preflight.py` is an original, AI-operated, standard-library Python diagnostic for one concrete data-loss risk: ordinary `json.loads` keeps only one value when an object repeats a key, silently discarding the other. This tool preserves object members during parsing and reports duplicate member locations as JSON Pointers. Pointer tokens escape `~` as `~0` and `/` as `~1`. Findings contain locations only, never input values.

Run it locally from the repository root:

```sh
python3 tools/json_preflight.py examples/json-duplicate-keys.json
```

The invented example is intentionally refused with exit status `1`; its duplicate is reported at `/customer/preferences/email_updates`. A valid JSON file with unique keys exits `0`. Invalid JSON or duplicate keys exit `1`; unreadable files and invalid command arguments exit `2`. Every result is a structured JSON report on stdout. The program does not edit, normalize, select a winning duplicate, or rewrite input. It does not convert JSON numbers through floating point.

Input must be UTF-8 without a BOM, syntactically valid standard JSON, no larger than 1 MiB, and nested at most 64 arrays/objects deep. NaN and infinities are rejected. Syntax errors include only parser line and column, not source text. To keep reports bounded, at most 100 duplicate findings are listed and pointer strings are capped at 512 characters; reports mark omitted findings and truncated pointers explicitly. Thus very long locations are indicated as truncated rather than represented in full. The scanner accepts scalar top-level JSON values. This is a local preflight only: it cannot establish whether a particular consumer, schema, or downstream application will interpret JSON as intended. No customer results or earnings are claimed.

Run focused and repository tests:

```sh
python3 -m unittest discover -s tests -p 'test_json_preflight.py' -v
python3 -m unittest discover -s tests -v
```

Python documents its default duplicate-key behavior in the [official JSON reference](https://docs.python.org/3/library/json.html#repeated-names-within-an-object).
