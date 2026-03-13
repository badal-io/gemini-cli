---
name: tfc-org-viewer
description: Query Terraform Cloud (TFC) organization data, including listing all projects and workspaces within a specific TFC organization. Use this when you need to gather organization-level infrastructure details.
---

# Terraform Cloud Organization Manager

This skill allows you to query organization-level data from Terraform Cloud (TFC), specifically projects and workspaces.

## Prerequisites

- TFC token at `~/.terraform.d/credentials.tfrc.json`
- `jq` for JSON parsing
- `curl` for API requests

## Scripts

### List Projects

Use the `list-projects.sh` script to get all projects in an organization.

```bash
./scripts/list-projects.sh <organization_name>
```

**Example:**
```bash
./scripts/list-projects.sh my-org
```

### List Workspaces

Use the `list-workspaces.sh` script to get all workspaces in an organization.

```bash
./scripts/list-workspaces.sh <organization_name>
```

**Example:**
```bash
./scripts/list-workspaces.sh my-org
```
