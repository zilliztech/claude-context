import { AstCodeSplitter, LangChainCodeSplitter } from "@zilliz/claude-context-core";
import type { Splitter } from "@zilliz/claude-context-core";
import type { RequestSplitterType } from "./config.js";

export function isRequestSplitterType(splitterType: unknown): splitterType is RequestSplitterType {
    return splitterType === "ast" || splitterType === "langchain";
}

export function resolveRequestSplitterType(splitterType: unknown): RequestSplitterType {
    return isRequestSplitterType(splitterType) ? splitterType : "ast";
}

export function createRequestSplitter(splitterType: RequestSplitterType): Splitter {
    switch (splitterType) {
        case "langchain":
            return new LangChainCodeSplitter(1000, 200);
        case "ast":
            return new AstCodeSplitter(2500, 300);
    }
}
