"""Bounded CSV export of delivery outcomes, safe to open in spreadsheets."""

import csv
import io


def stream_logs(result_page, user, identifier):
    yield "row,email,status,provider_id,error\r\n"
    after = 0
    while True:
        rows = result_page(user, identifier, after, 250)
        if not rows:
            break
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        for row in rows:
            # Prevent spreadsheet formula evaluation in downloaded logs.
            values = [
                row["row_no"],
                row["email"],
                row["state"],
                row["provider_id"] or "",
                row["error"] or "",
            ]
            writer.writerow(
                [
                    "'" + value
                    if isinstance(value, str) and value.startswith(("=", "+", "-", "@"))
                    else value
                    for value in values
                ]
            )
        yield buffer.getvalue()
        after = rows[-1]["row_no"]
