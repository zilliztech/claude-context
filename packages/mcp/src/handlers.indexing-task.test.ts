import assert from "node:assert/strict";
import test from "node:test";

import { ToolHandlers } from "./handlers.js";

test("cancelAndAwaitIndexingTask aborts and waits for the active task", async () => {
    const handlers = new ToolHandlers({} as any, {} as any);
    const controller = new AbortController();
    let settled = false;
    const promise = new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => {
            setImmediate(() => {
                settled = true;
                resolve();
            });
        }, { once: true });
    });
    const indexingTasks = (handlers as any).indexingTasks as Map<string, unknown>;
    indexingTasks.set("/tmp/example", { controller, promise });

    await (handlers as any).cancelAndAwaitIndexingTask("/tmp/example");

    assert.equal(controller.signal.aborted, true);
    assert.equal(settled, true);
    assert.equal(indexingTasks.has("/tmp/example"), false);
});

test("cancelAndAwaitIndexingTask preserves a newer task for the same path", async () => {
    const handlers = new ToolHandlers({} as any, {} as any);
    const oldController = new AbortController();
    const newController = new AbortController();
    let resolveOld!: () => void;
    const oldPromise = new Promise<void>((resolve) => {
        resolveOld = resolve;
    });
    const indexingTasks = (handlers as any).indexingTasks as Map<string, unknown>;
    const oldTask = { controller: oldController, promise: oldPromise };
    const newTask = { controller: newController, promise: Promise.resolve() };
    indexingTasks.set("/tmp/example", oldTask);

    const cancellation = (handlers as any).cancelAndAwaitIndexingTask("/tmp/example");
    indexingTasks.set("/tmp/example", newTask);
    resolveOld();
    await cancellation;

    assert.equal(oldController.signal.aborted, true);
    assert.equal(indexingTasks.get("/tmp/example"), newTask);
});
