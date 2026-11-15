"""Standalone local review page. It does not use the ReproLab web app."""

import html


def render_review(sessions, path):
    parts = [
        "<!DOCTYPE html>",
        "<html lang=\"en\"><head><meta charset=\"utf-8\">",
        "<title>ReproLab live observation review</title>",
        "<style>",
        "body{font:16px/1.45 system-ui,sans-serif;margin:32px;max-width:1100px;color:#1c1917}",
        "h1{font-size:28px} h2{margin-top:32px} table{border-collapse:collapse;width:100%;margin:12px 0}",
        "th,td{border:1px solid #d6d3d1;padding:8px;vertical-align:top;text-align:left}",
        "th{background:#f5f5f4} .possible{background:#fef3c7} .observed{background:#ecfccb}",
        ".unclear{background:#fee2e2}",
        "</style></head><body>",
        "<h1>ReproLab expanded observation review</h1>",
        "<p>Model rows are what Gemini reported. Risk rows are a separate reading of those reports. "
        "Neither one establishes chemical contamination. A blank category was not observed in the windows that were sent.</p>",
    ]
    for session in sessions:
        parts.append("<h2>" + html.escape(str(session.get("videoId"))) + "</h2>")
        source = session.get("source") or {}
        parts.append(
            "<p>Session "
            + html.escape(str(session.get("sessionId")))
            + ". File "
            + html.escape(str(source.get("filename")))
            + ". SHA-256 "
            + html.escape(str(source.get("sha256")))
            + ".</p>"
        )
        report = session.get("protocolReport") or {}
        if report:
            parts.append("<h3>Protocol check, after observation</h3>")
            parts.append(_table(
                ["Step", "Pair", "Decision", "Confirmed"],
                [
                    [
                        step.get("index"),
                        str(step.get("sourceCupId")) + " to " + str(step.get("destinationCupId")),
                        step.get("decision"),
                        step.get("confirmed"),
                    ]
                    for step in report.get("steps") or []
                ],
            ))
        parts.append("<h3>Model observations</h3>")
        parts.append(_observation_table(session.get("observations") or []))
        parts.append("<h3>Derived risks</h3>")
        risks = session.get("derivedRisks") or []
        if not risks:
            parts.append("<p>No derived risk was produced from the visible handling reports.</p>")
        else:
            parts.append(_table(
                ["When", "Category", "Reading", "Human review"],
                [
                    [
                        _span(risk),
                        risk.get("category"),
                        risk.get("interpretation"),
                        risk.get("requiresHumanReview"),
                    ]
                    for risk in risks
                ],
            ))
        parts.append("<h3>Windows</h3>")
        parts.append(_table(
            ["Window", "Offset ms", "Duration ms", "Call", "Observations", "Error"],
            [
                [
                    item.get("index"),
                    item.get("sourceOffsetMs"),
                    item.get("durationMs"),
                    item.get("remoteCallMade"),
                    item.get("observationCount"),
                    (item.get("error") or {}).get("category") if isinstance(item.get("error"), dict) else "",
                ]
                for item in session.get("windows") or []
            ],
        ))
    parts.append("</body></html>")
    path.write_text("\n".join(parts), encoding="utf-8")
    return path


def _observation_table(observations):
    if not observations:
        return "<p>No expanded observation was returned.</p>"
    rows = []
    for item in observations:
        rows.append([
            _span(item),
            item.get("category"),
            item.get("observationStatus"),
            item.get("summary"),
            ", ".join(str(stamp) for stamp in item.get("evidenceTimestampsMs") or []),
            item.get("visibilityNote"),
            "yes" if item.get("humanVerificationRequired") else "no",
        ])
    return _table(
        ["When", "Category", "Status", "What was visible", "Evidence ms", "Uncertainty", "Human review"],
        rows,
        status_column=2,
    )


def _table(headers, rows, status_column=None):
    head = "".join("<th>" + html.escape(str(header)) + "</th>" for header in headers)
    body = []
    for row in rows:
        status = row[status_column] if status_column is not None else ""
        cells = "".join(
            "<td>" + html.escape("" if value is None else str(value)) + "</td>" for value in row
        )
        body.append("<tr class=\"" + html.escape(str(status)) + "\">" + cells + "</tr>")
    return "<table><thead><tr>" + head + "</tr></thead><tbody>" + "".join(body) + "</tbody></table>"


def _span(item):
    return str(item.get("eventStartMs")) + "-" + str(item.get("eventEndMs"))
