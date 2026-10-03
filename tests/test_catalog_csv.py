"""Synthetic acceptance checks for CSV preservation and refusal behavior."""

import contextlib
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.catalog_csv import _write_new, inspect_bytes, main, normalized_text


class CatalogCsvTests(unittest.TestCase):
    def test_bom_multiline_and_leading_zero_round_trip(self):
        source = b'\xef\xbb\xbfTitle,URL handle,SKU,Price,Description\r\n"Mug, blue",mug,0007,09.90,"line one\r\nline two ""quoted"""\r\n'
        report, rows = inspect_bytes(source)
        self.assertTrue(report["structurally_safe"])
        self.assertEqual(rows[1][2:4], ["0007", "09.90"])
        reread = list(csv.reader(io.StringIO(normalized_text(rows), newline="")))
        self.assertEqual(reread, rows)
        self.assertEqual(reread[1][4], 'line one\r\nline two "quoted"')

    def test_embedded_bare_carriage_return_is_preserved(self):
        report, rows = inspect_bytes(b'Title,Description\nMug,"one\rtwo"\n')
        self.assertTrue(report["structurally_safe"])
        reread = list(csv.reader(io.StringIO(normalized_text(rows), newline="")))
        self.assertEqual(reread, rows)

    def test_long_description_within_file_limit_is_accepted(self):
        report, rows = inspect_bytes(b'Title,Description\nMug,"' + b'a' * 140_000 + b'"\n')
        self.assertTrue(report["structurally_safe"])
        self.assertEqual(len(rows[1][1]), 140_000)

    def test_malformed_quotes_and_width_are_refused(self):
        for source in (b'Title,Price\n"open,2\n', b'Title\nquo"te\n',
                       b'Title\n"closed" junk\n', b'Title,Price\nMug\n'):
            with self.subTest(source=source):
                report, rows = inspect_bytes(source)
                self.assertFalse(report["structurally_safe"])
                self.assertIsNone(rows)

    def test_encoding_duplicate_headers_and_nul_are_refused(self):
        for source in (b'Title\n\xff\n', b'Title,Title\na,b\n', b'Title\na\x00\n'):
            report, rows = inspect_bytes(source)
            self.assertFalse(report["structurally_safe"])
            self.assertIsNone(rows)

    def test_required_headers_depend_on_declared_operation(self):
        source = b'Title\nMug\n'
        create, _ = inspect_bytes(source)
        update, _ = inspect_bytes(source, mode="update")
        variants, _ = inspect_bytes(source, variants=True)
        self.assertFalse(any(f["code"] == "missing_required_header" for f in create["findings"]))
        self.assertTrue(any(f["code"] == "missing_required_header" for f in update["findings"]))
        self.assertTrue(any(f["code"] == "missing_required_header" for f in variants["findings"]))

    def test_update_sku_dependency_and_blank_variant_titles(self):
        source = b'Title,URL handle,SKU,Price,Option1 name,Option1 value\nMug,mug,001,12,Color,Blue\n,mug,002,12,Color,Red\n'
        report, _ = inspect_bytes(source, mode="update", variants=True)
        self.assertFalse(any(f["severity"] == "error" for f in report["findings"]))
        missing, _ = inspect_bytes(b'Title,URL handle,SKU\nMug,mug,001\n', mode="update")
        self.assertEqual(sum(f["code"] == "missing_required_header" for f in missing["findings"]), 2)

    def test_prices_and_duplicate_skus_are_reported_without_changing_values(self):
        report, rows = inspect_bytes(b'Title,SKU,Price\nMug,0007,$12\nCup,0007,1e3\nPlate,009,\n')
        codes = [f["code"] for f in report["findings"]]
        self.assertEqual(codes.count("invalid_price"), 2)
        self.assertIn("duplicate_sku", codes)
        self.assertIn("blank_price", codes)
        self.assertEqual(rows[1][1:], ["0007", "$12"])

    def test_legacy_profile_is_explicit_and_headers_are_not_mapped(self):
        source = b'Title,Handle,Variant SKU,Variant Price\nMug,mug,0001,$5\n'
        report, rows = inspect_bytes(source, header_style="legacy")
        self.assertIn("invalid_price", [f["code"] for f in report["findings"]])
        self.assertEqual(rows[0][1], "Handle")
        current, _ = inspect_bytes(source, mode="update")
        self.assertIn("missing_required_header", [f["code"] for f in current["findings"]])

    def test_row_limit(self):
        report, rows = inspect_bytes(b'Title\nOne\nTwo\n', max_rows=1)
        self.assertIsNone(rows)
        self.assertIn("row_limit", [f["code"] for f in report["findings"]])

    def test_formula_export_requires_explicit_acknowledgment(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            source.write_text('Title\n" =SUM(1,2)"\n', encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(main([str(source), "--normalize", str(output)]), 1)
            self.assertFalse(output.exists())
            self.assertEqual(json.loads(stdout.getvalue())["formula_like_cells"], 1)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main([str(source), "--normalize", str(output), "--allow-formula-like"]), 0)
            with output.open(encoding="utf-8", newline="") as handle:
                self.assertEqual(list(csv.reader(handle))[1][0], " =SUM(1,2)")

    def test_cli_original_and_existing_outputs_are_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            source.write_bytes(b'Title\r\nMug\r\n')
            original = source.read_bytes()
            for args in ([str(source), "--normalize", str(source)],
                         [str(source), "--report", str(source)]):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    main(args)
                self.assertEqual(source.read_bytes(), original)
            output = Path(directory) / "output.csv"
            report = Path(directory) / "report.json"
            self.assertEqual(main([str(source), "--normalize", str(output), "--report", str(report)]), 0)
            self.assertEqual(source.read_bytes(), original)
            self.assertTrue(json.loads(report.read_text())["normalization"]["written"])
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main([str(source), "--normalize", str(output)])

    def test_missing_report_directory_does_not_create_csv_and_retry_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            report = Path(directory) / "missing" / "report.json"
            original = b'Title\r\nMug\r\n'
            source.write_bytes(original)
            args = [str(source), "--normalize", str(output), "--report", str(report)]
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(args), 2)
            self.assertFalse(output.exists())
            self.assertFalse(report.exists())
            self.assertEqual(source.read_bytes(), original)
            report.parent.mkdir()
            self.assertEqual(main(args), 0)

    def test_late_write_failure_removes_only_new_outputs_and_allows_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            report = Path(directory) / "report.json"
            source.write_bytes(b'Title\nMug\n')
            original = source.read_bytes()
            args = [str(source), "--normalize", str(output), "--report", str(report)]

            def failing_write(path, text, created):
                _write_new(path, text, created)
                if path == report:
                    raise OSError("simulated late report failure")

            with patch("tools.catalog_csv._write_new", side_effect=failing_write), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(args), 2)
            self.assertFalse(output.exists())
            self.assertFalse(report.exists())
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(main(args), 0)

    def test_failure_preserves_an_externally_replaced_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            report = Path(directory) / "report.json"
            source.write_bytes(b'Title\nMug\n')
            backup = Path(directory) / "moved-output.csv"

            def replacing_write(path, text, created):
                if path == report:
                    output.rename(backup)
                    output.write_text("external replacement", encoding="utf-8")
                    raise OSError("simulated subsequent report failure")
                _write_new(path, text, created)

            with patch("tools.catalog_csv._write_new", side_effect=replacing_write), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(source), "--normalize", str(output), "--report", str(report)]), 2)
            self.assertEqual(output.read_text(), "external replacement")
            self.assertEqual(source.read_bytes(), b'Title\nMug\n')

    def test_failure_preserves_external_report_created_during_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            report = Path(directory) / "report.json"
            source.write_bytes(b'Title\nMug\n')

            def racing_write(path, text, created):
                if path == report:
                    report.write_text("external report", encoding="utf-8")
                _write_new(path, text, created)

            with patch("tools.catalog_csv._write_new", side_effect=racing_write), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(source), "--normalize", str(output), "--report", str(report)]), 2)
            self.assertFalse(output.exists())
            self.assertEqual(report.read_text(), "external report")


if __name__ == "__main__":
    unittest.main()
