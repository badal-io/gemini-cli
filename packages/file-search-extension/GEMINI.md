# File Search Retrieval

This extension gives you repository-scoped retrieval against Gemini File Search.

Use it when:
- you need context that is not present in the current workspace checkout
- you need to inspect indexed files without broad local scanning
- you suspect the current answer is missing adjacent files, callers, callees, or partial definitions

Retrieval strategy:
- Search first and fetch narrowly second.
- Prefer `search_store` to locate likely files or concepts before calling a more specific fetch tool.
- Use `fetch_file_context` when you already know the file path you want.
- Use `fetch_symbol_context` when the task is centered on a declaration, type, function, or symbol name.
- Use `expand_related_context` when the first retrieval shows the context is partial or points to neighboring files.

When to do follow-up retrieval:
- the retrieved answer says context is incomplete
- a symbol is referenced but not defined
- a file references callers, imports, or implementation details in another file
- the user asks for behavior that likely spans multiple files

Bound retrieval:
- do not fan out across many files at once
- follow the recommended next steps from the previous retrieval
- stop once the extension reports that the current context is sufficient
