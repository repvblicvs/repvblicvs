"""Tests for the read-only JSON duplicate-key preflight."""

import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools.json_preflight import MAX_BYTES, MAX_NESTING, inspect_bytes, main


class JsonPreflightTests(unittest.TestCase):
    def test_documented_example_is_refused_at_expected_pointer(self):
        example = Path(__file__).parent.parent / "examples" / "json-duplicate-keys.json"
        report = inspect_bytes(example.read_bytes())
        self.assertEqual(report["status"], "refused")
        self.assertEqual(
            [item["pointer"] for item in report["duplicates"]],
            ["/customer/preferences/email_updates"],
        )
        result = subprocess.run(
            [sys.executable, "tools/json_preflight.py", str(example)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            json.loads(result.stdout)["duplicates"][0]["pointer"],
            "/customer/preferences/email_updates",
        )
        self.assertEqual(result.stderr, "")

    def test_duplicates_at_root_nested_and_inside_array(self):
        report = inspect_bytes(b'{"x":1,"x":2,"outer":{"y":1,"y":2},"items":[{"z":1,"z":2}]}')
        self.assertEqual(report["status"], "refused")
        self.assertEqual(
            [item["pointer"] for item in report["duplicates"]],
            ["/x", "/outer/y", "/items/0/z"],
        )
        self.assertEqual(report["duplicate_count"], 3)

    def test_pointer_escapes_tilde_and_slash(self):
        report = inspect_bytes(b'{"a/b~c":{"m/n~":0,"m/n~":1},"a/b~c":2}')
        self.assertEqual(
            [item["pointer"] for item in report["duplicates"]],
            ["/a~1b~0c/m~1n~0", "/a~1b~0c"],
        )

    def test_distinct_sibling_objects_do_not_share_duplicate_state(self):
        report = inspect_bytes(b'[{"key":1},{"key":2}]')
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["duplicate_count"], 0)

    def test_valid_scalar_top_levels(self):
        for source in (b'null', b'true', b'-12', b'1.25e+2', b'"text"'):
            with self.subTest(source=source):
                self.assertEqual(inspect_bytes(source)["status"], "ok")

    def test_input_bytes_are_never_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.json"
            original = b'{"key":1,"key":2}\r\n'
            path.write_bytes(original)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main([str(path)]), 1)
            self.assertEqual(path.read_bytes(), original)

    def test_syntax_diagnostic_never_echoes_input(self):
        secret = b'{"password":"do-not-copy-this","unfinished":}'
        report = inspect_bytes(secret)
        serialized = json.dumps(report)
        self.assertEqual(report["error"]["code"], "invalid_json")
        self.assertNotIn("do-not-copy-this", serialized)
        self.assertNotIn("unfinished", serialized)
        self.assertIn("line", report["error"])
        self.assertIn("column", report["error"])

    def test_invalid_encoding_bom_and_nonstandard_numbers(self):
        cases = (
            (b'{"x":"\xff"}', "invalid_utf8"),
            (b'\xef\xbb\xbf{"x":1}', "utf8_bom"),
            (b'{"x":NaN}', "nonstandard_number"),
            (b'Infinity', "nonstandard_number"),
            (b'-Infinity', "nonstandard_number"),
        )
        for source, code in cases:
            with self.subTest(code=code, source=source):
                self.assertEqual(inspect_bytes(source)["error"]["code"], code)

    def test_size_and_nesting_limits(self):
        self.assertEqual(inspect_bytes(b' ' * (MAX_BYTES - 4) + b'null')["status"], "ok")
        self.assertEqual(inspect_bytes(b' ' * (MAX_BYTES + 1))["error"]["code"], "size_limit")
        accepted = b'[' * MAX_NESTING + b'0' + b']' * MAX_NESTING
        rejected = b'[' * (MAX_NESTING + 1) + b'0' + b']' * (MAX_NESTING + 1)
        self.assertEqual(inspect_bytes(accepted)["status"], "ok")
        self.assertEqual(inspect_bytes(rejected)["error"]["code"], "nesting_limit")

    def test_findings_are_bounded_and_count_all_duplicates(self):
        source = b'{"x":0' + b',"x":1' * 150 + b'}'
        report = inspect_bytes(source)
        self.assertEqual(report["duplicate_count"], 150)
        self.assertEqual(len(report["duplicates"]), 100)
        self.assertEqual(report["duplicates_omitted"], 50)
        self.assertLess(len(json.dumps(report).encode()), 512 * 1024)

    def test_pointer_length_is_bounded_and_signaled(self):
        name = "x" * 600
        report = inspect_bytes(json.dumps({name: 1, "other": 2}).replace(
            '"other": 2', f'{json.dumps(name)}: 2').encode())
        self.assertEqual(len(report["duplicates"][0]["pointer"]), 512)
        self.assertTrue(report["duplicates"][0]["pointer_truncated"])

    def test_cli_exit_codes_and_structured_io_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "valid.json"
            path.write_bytes(b'{"ok":true}')
            result = subprocess.run(
                [sys.executable, "tools/json_preflight.py", str(path)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)["status"], "ok")
            path.write_bytes(b'{"a":1,"a":2}')
            result = subprocess.run(
                [sys.executable, "tools/json_preflight.py", str(path)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["duplicates"][0]["pointer"], "/a")
            missing = Path(directory) / "not-present.json"
            result = subprocess.run(
                [sys.executable, "tools/json_preflight.py", str(missing)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["error"]["code"], "file_error")
            self.assertEqual(result.stderr, "")

    def test_invalid_path_emits_structured_error_without_echo(self):
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = main(["private-name\x00.json"])
        self.assertEqual(code, 2)
        report = json.loads(stdout.getvalue())
        self.assertEqual(report["error"]["code"], "file_error")
        self.assertNotIn("private-name", stdout.getvalue())

    def test_bad_command_emits_report_without_echoing_argument(self):
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = main(["--unknown-secret-argument"])
        self.assertEqual(code, 2)
        report = json.loads(stdout.getvalue())
        self.assertEqual(report["error"]["code"], "command_error")
        self.assertNotIn("unknown-secret-argument", stdout.getvalue())

    def test_help_also_emits_only_a_structured_report(self):
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = main(["--help"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout.getvalue())["status"], "help")


if __name__ == "__main__":
    unittest.main()
