

export function fileExtensionToLanguage(ext?: string): string {
    if (!ext) return "unknown";

    switch (ext.toLowerCase()) {
        case ".ts":
        case ".tsx":
            return "typescript";

        case ".js":
        case ".jsx":
            return "javascript";

        case ".py":
            return "python";

        case ".java":
            return "java";

        case ".cs":
            return "csharp";

        case ".go":
            return "go";

        case ".rs":
            return "rust";

        case ".cpp":
        case ".cc":
        case ".cxx":
            return "cpp";

        case ".c":
            return "c";

        case ".html":
            return "html";

        case ".css":
            return "css";

        case ".json":
            return "json";

        case ".md":
            return "markdown";

        default:
            return "unknown";
    }
}