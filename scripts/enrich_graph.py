"""Enrich the graphify code graph with documentation + domain-concept nodes.

Run after `python -m graphify update . --force` so the AST graph is fresh.

This script is deterministic and idempotent: it removes any nodes whose id starts with
`doc_` or `concept_` before re-adding them, then re-clusters and regenerates all graphify
outputs (graph.json, graph.html, graph.svg, graph.graphml, cypher.txt, GRAPH_REPORT.md).
"""
import json
from pathlib import Path

import networkx as nx
from networkx.readwrite import json_graph

from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_html, to_svg, to_graphml, to_cypher
from graphify.detect import detect

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "graphify-out"
GRAPH = OUT / "graph.json"

DOCS = {
    "00": ("Documentation Index", "docs/00-DOCUMENTATION-INDEX.md"),
    "01": ("Product Overview", "docs/01-PRODUCT-OVERVIEW.md"),
    "02": ("Current Architecture", "docs/02-CURRENT-ARCHITECTURE.md"),
    "03": ("Module Catalog", "docs/03-MODULE-CATALOG.md"),
    "04": ("Domain Data Model", "docs/04-DOMAIN-DATA-MODEL.md"),
    "05": ("Business Rules & Calculations", "docs/05-BUSINESS-RULES-AND-CALCULATIONS.md"),
    "06": ("Target Backend Architecture", "docs/06-TARGET-BACKEND-ARCHITECTURE.md"),
    "07": ("Database Design", "docs/07-DATABASE-DESIGN.md"),
    "08": ("API Design", "docs/08-API-DESIGN.md"),
    "09": ("Operations Runbook", "docs/09-OPERATIONS-RUNBOOK.md"),
    "10": ("Maintenance & Changelog", "docs/10-MAINTENANCE-AND-CHANGELOG.md"),
}

# concept -> (label, [code node ids], [doc numbers])
CONCEPTS = {
    "payroll_engine": ("Payroll Engine", ["data_store_generatepayrollformonth",
                       "utils_calculations_calculatepayrollentry",
                       "src_components_payroll_payrollview_tsx"], ["03", "05", "07", "08"]),
    "overtime": ("Overtime Calculation", ["utils_calculations_calculateworkingandot",
                 "utils_calculations_allocatedailymultiprojectwork",
                 "data_store_addorupdateovertimehours",
                 "src_components_attendance_attendanceview_tsx"], ["05", "07"]),
    "attendance": ("Attendance Workflow", ["data_store_addattendancerecord",
                   "data_store_approveattendancerecord",
                   "src_components_attendance_attendanceview_tsx"], ["03", "04", "05"]),
    "advance_recovery": ("Advance Recovery", ["data_store_approvepayrollrun",
                         "utils_calculations_calculatepayrollentry"], ["05", "07"]),
    "reminder_engine": ("Red Alert / Reminder Engine", ["data_store_getemialerts",
                        "data_store_getservicealerts", "data_store_getinsurancealerts",
                        "data_store_getpucalerts", "data_store_getfitnessalerts",
                        "data_store_getlicensealerts",
                        "utils_calculations_evaluatereminderstatus",
                        "src_components_reminders_remindersview_tsx"], ["01", "03", "05", "07"]),
    "compliance_renewals": ("Compliance Renewals", ["data_store_renewmachineinsurance",
                            "data_store_renewmachinepuc", "data_store_renewmachinefitness",
                            "src_components_assets_assetsview_tsx"], ["03", "05"]),
    "emi_amortization": ("EMI Amortization", ["emi_emicalculatormodal_generateschedule",
                         "data_store_addemiloan", "data_store_recordemipayment",
                         "src_components_emi_emiview_tsx"], ["03", "05", "07"]),
    "asset_master": ("Crane Asset Master", ["data_store_addmachine",
                     "src_components_assets_assetsview_tsx"], ["03", "04", "07"]),
    "projects": ("Project Management", ["data_store_addproject",
                 "src_components_projects_projectsview_tsx"], ["01", "03", "04"]),
    "employee_master": ("Workforce Master", ["data_store_addemployee",
                        "src_components_employees_employeesview_tsx"], ["03", "04"]),
    "expenses": ("Project Expenses", ["data_store_addexpense",
                 "src_utils_excelandpdf_exportprojectexpenses"], ["03", "04"]),
    "machine_hours": ("Machine Working Logs", ["data_store_addmachineworkinglog",
                      "utils_excelandpdf_parsemachineworkingexcel",
                      "src_components_machine_working_machineworkingview_tsx"], ["03", "07"]),
    "rbac": ("Role-Based Access Control", ["data_store_updateuserrole", "src_app_tsx",
             "src_components_settings_settingsview_tsx",
             "src_components_auth_loginpage_tsx"], ["01", "02", "05", "06", "08"]),
    "audit_log": ("Audit Trail", ["data_store_addaudit"], ["04", "06", "07", "09"]),
    "localstorage": ("localStorage Persistence", ["data_store_loadfromstorage",
                     "data_store_savetostorage", "data_store_resettodemodata"], ["02", "06"]),
    "excel_export": ("Excel Reports & Imports", ["utils_excelandpdf_exporttoxlsx",
                     "src_components_reports_reportsview_tsx"], ["03", "08"]),
    "seed_data": ("Demo Seed Dataset", ["src_data_seeddata_ts",
                  "data_seeddata_generateseedattendance"], ["03", "05"]),
    "red_alerts": ("Dashboard Red Alerts", ["src_components_dashboard_dashboardview_tsx",
                   "src_components_layout_sidebar_tsx"], ["01", "03"]),
    "payroll_lock": ("Payroll Approval & Lock", ["data_store_approvepayrollrun",
                     "payroll_payrollview_handleapprove"], ["05", "08", "09"]),
    "salary_slip": ("Salary Slip", ["payroll_salaryslipmodal_handleprint"], ["03", "08"]),
    "company_settings": ("Company Settings", ["data_store_updatecompanysettings",
                         "src_components_settings_settingsview_tsx"], ["01", "04"]),
    "target_backend": ("Target Backend Architecture", [], ["06", "08", "09"]),
    "database_design": ("Target Database Design", [], ["07", "04", "05"]),
    "operations": ("Operations & DR", [], ["09", "10"]),
    "api_implementation": ("Fastify API — Phase 1", [
        "server_src_app_ts", "server_src_modules_payroll_payroll_routes_ts",
        "server_src_modules_attendance_attendance_routes_ts",
        "server_src_modules_identity_identity_routes_ts",
        "server_src_modules_workforce_workforce_routes_ts",
    ], ["06", "08", "10"]),
    "db_implementation": ("PostgreSQL Schema — Implemented", [
        "server_db_migrations_0001_init_sql", "server_src_db_tenant_ts",
        "server_src_db_pool_ts",
    ], ["07", "09"]),
    "server_payroll": ("Server Payroll Engine", [
        "payroll_payroll_service_generatepayroll", "payroll_payroll_service_approvepayroll",
        "domain_calculations_calculatepayrollentry", "payroll_payroll_routes_idemkey",
    ], ["05", "06", "08"]),
    "rls": ("Tenant Row-Level Security", ["server_src_db_tenant_ts", "0001_init_attendance_records"], ["06", "07"]),
    "idempotency": ("Idempotency Keys", ["common_idempotency_idempotent", "payroll_payroll_routes_hash"], ["06", "08"]),
    "audit_implementation": ("Audit & Outbox", ["common_audit_writeaudit", "0001_init_audit_logs"], ["06", "09"]),
}

SEMANTIC_EDGES = [
    ("attendance", "payroll_engine", "feeds", 0.95),
    ("overtime", "payroll_engine", "feeds", 0.9),
    ("advance_recovery", "payroll_engine", "feeds", 0.9),
    ("projects", "overtime", "defines_rate_for", 0.85),
    ("asset_master", "reminder_engine", "source_of", 0.9),
    ("employee_master", "reminder_engine", "source_of", 0.85),
    ("emi_amortization", "reminder_engine", "source_of", 0.85),
    ("compliance_renewals", "reminder_engine", "resolves", 0.8),
    ("red_alerts", "reminder_engine", "displays", 0.95),
    ("payroll_lock", "payroll_engine", "finalizes", 0.9),
    ("payroll_engine", "salary_slip", "produces", 0.85),
    ("localstorage", "rbac", "undermines", 0.8),
    ("localstorage", "target_backend", "motivates", 0.9),
    ("database_design", "target_backend", "implements", 0.9),
    ("target_backend", "operations", "operated_by", 0.8),
    ("audit_log", "operations", "supports", 0.75),
    ("server_payroll", "payroll_engine", "implements", 0.95),
    ("api_implementation", "target_backend", "implements", 0.9),
    ("db_implementation", "database_design", "implements", 0.95),
    ("rls", "target_backend", "enforces", 0.85),
    ("idempotency", "api_implementation", "supports", 0.8),
    ("audit_implementation", "audit_log", "implements", 0.9),
    ("server_payroll", "localstorage", "replaces", 0.9),
]


def add_node(G, nid, label, ftype, source):
    G.add_node(nid, label=label, file_type=ftype, source_file=source,
               source_location=None, confidence="EXTRACTED")


def main():
    data = json.loads(GRAPH.read_text(encoding="utf-8"))
    G = json_graph.node_link_graph(data, edges="links")
    # directed graph from graphify -> convert to undirected for clustering consistency
    if G.is_directed():
        G = G.to_undirected()

    for n in [n for n in list(G.nodes) if n.startswith(("doc_", "concept_"))]:
        G.remove_node(n)

    for num, (label, path) in DOCS.items():
        add_node(G, f"doc_{num}", label, "document", path)
    for key, (label, _codes, _docs) in CONCEPTS.items():
        add_node(G, f"concept_{key}", label, "concept", "docs/04-DOMAIN-DATA-MODEL.md")

    # index links to all docs
    for num in DOCS:
        if num != "00":
            G.add_edge("doc_00", f"doc_{num}", relation="references",
                       confidence="EXTRACTED", confidence_score=1.0, source_file=DOCS["00"][1])

    # docs describe concepts
    for key, (_label, _codes, docs) in CONCEPTS.items():
        for num in docs:
            if num in DOCS:
                G.add_edge(f"doc_{num}", f"concept_{key}", relation="describes",
                           confidence="EXTRACTED", confidence_score=1.0, source_file=DOCS[num][1])

    # concepts implemented in code (only add edge if target node exists)
    for key, (_label, codes, _docs) in CONCEPTS.items():
        for code in codes:
            if code in G:
                G.add_edge(f"concept_{key}", code, relation="implemented_in",
                           confidence="EXTRACTED", confidence_score=1.0,
                           source_file=G.nodes[code].get("source_file", ""))

    # semantic cross-links
    for a, b, rel, score in SEMANTIC_EDGES:
        G.add_edge(f"concept_{a}", f"concept_{b}", relation=rel,
                   confidence="INFERRED", confidence_score=score,
                   source_file="docs/05-BUSINESS-RULES-AND-CALCULATIONS.md")

    communities = cluster(G)
    cohesion = score_all(G, communities)

    # Meaningful community labels: prefer doc/concept nodes present in the community
    labels = {}
    for cid, members in communities.items():
        preferred = [m for m in members if m.startswith(("doc_", "concept_"))]
        if preferred:
            labels[cid] = G.nodes[preferred[0]].get("label", preferred[0])
        else:
            labels[cid] = G.nodes[members[0]].get("label", f"Community {cid}") if members else f"Community {cid}"

    detection = detect(ROOT)
    questions = suggest_questions(G, communities, labels)
    report = generate(G, communities, cohesion, labels, god_nodes(G),
                      surprising_connections(G, communities), detection,
                      {"input": 0, "output": 0}, str(ROOT), suggested_questions=questions)
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")

    to_json(G, communities, str(GRAPH), force=True)
    to_html(G, communities, str(OUT / "graph.html"), community_labels=labels)
    to_svg(G, communities, str(OUT / "graph.svg"), community_labels=labels)
    # GraphML cannot serialize None attribute values; sanitize a copy.
    H = G.copy()
    for _n, attrs in H.nodes(data=True):
        for k, v in list(attrs.items()):
            if v is None:
                attrs[k] = ""
    for _u, _v, attrs in H.edges(data=True):
        for k, v in list(attrs.items()):
            if v is None:
                attrs[k] = ""
    to_graphml(H, communities, str(OUT / "graph.graphml"))
    to_cypher(G, str(OUT / "cypher.txt"))
    (OUT / "community_labels.json").write_text(
        json.dumps({str(k): v for k, v in labels.items()}, indent=2), encoding="utf-8")

    print(f"Enriched graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, "
          f"{len(communities)} communities")
    print("Outputs: graph.json, graph.html, graph.svg, graph.graphml, cypher.txt, GRAPH_REPORT.md")


if __name__ == "__main__":
    main()
