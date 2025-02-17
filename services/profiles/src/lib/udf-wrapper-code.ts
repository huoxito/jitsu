import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";

export const functionsLibCode = `const DropRetryErrorName = "Drop & RetryError";
const RetryErrorName = "RetryError";
class RetryError extends Error {
    constructor(message, options) {
        super(message);
        this.name = options?.drop ? "${DropRetryErrorName}" : "${RetryErrorName}";
    }
}

export { DropRetryErrorName, RetryError, RetryErrorName };`;

export const chainWrapperCode = `//** @UDF_FUNCTIONS_IMPORT **//
import {DropRetryErrorName, RetryError, RetryErrorName} from "@jitsu/functions-lib";

global.RetryError = RetryError;

export function checkError(chainRes) {
    for (const el of chainRes.execLog) {
        const error = el.error;
        if (error) {
            throw error;
            // _jitsu_log.error.apply(undefined, [{
            //     function: {
            //         ..._jitsu_funcCtx.function,
            //         id: error.functionId || el.functionId
            //     }
            // }, \`Function execution failed\`, error.name, error.message], {arguments: {copy: true}});
        }
    }
}

function isDropResult(result) {
    return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

async function runChain(
    chain,
    ctx,
    events,
    user
) {
    const execLog = [];
    const f = chain[0];
    let result = undefined;
    try {
        result = await f.f(ctx, events, user);
    } catch (err) {
        if (err.name === DropRetryErrorName) {
            result = "drop";
        }
        if (f.meta?.retryPolicy) {
            err.retryPolicy = f.meta.retryPolicy;
        }
        execLog.push({
            functionId: f.id,
            error: err,
        });
    }
    if (isDropResult(result)) {
        result = undefined
    }
    return {result, execLog};
}

const wrappedFunctionChain = async function (ctx, events, user) {
    let chain = [];
    //** @UDF_FUNCTIONS_CHAIN **//
    const chainRes = await runChain(chain, ctx, events, user);
    checkError(chainRes);
    return chainRes.result;
};

const wrappedUserFunction = (id, f, funcCtx) => {

    const log = {
        info: (...args) => {
            _jitsu_log.info.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        error: (...args) => {
            _jitsu_log.error.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        warn: (...args) => {
            _jitsu_log.warn.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        debug: (...args) => {
            _jitsu_log.debug.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
    }

    const store = {
        set: async (key, value, opts) => {
            await _jitsu_store.set.apply(undefined, [key, value, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        del: async key => {
            await _jitsu_store.del.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        get: async key => {
            const res = await _jitsu_store.get.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
            return res ? JSON.parse(res) : undefined;
        },
        ttl: async key => {
            return await _jitsu_store.ttl.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
    }

    const fetch = async (url, opts, extras) => {
        let res
        if (extras) {
            res = await _jitsu_fetch.apply(undefined, [url, opts, {ctx: funcCtx, event: extras.event}], {
                arguments: {copy: true},
                result: {promise: true}
            });
        } else {
            res = await _jitsu_fetch.apply(undefined, [url, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        }
        const r = JSON.parse(res);

        return {
            ...r,
            json: async () => {
                return JSON.parse(r.body);
            },
            text: async () => {
                return r.body;
            },
            arrayBuffer: async () => {
                throw new Error("Method 'arrayBuffer' is not implemented");
            },
            blob: async () => {
                throw new Error("Method 'blob' is not implemented");
            },
            formData: async () => {
                throw new Error("Method 'formData' is not implemented");
            },
            clone: async () => {
                throw new Error("Method 'clone' is not implemented");
            },
        };
    }

    return async function (c, events, user) {
        const fetchLogEnabled = _jitsu_fetch_log_level !== "debug" || (funcCtx.function.debugTill && funcCtx.function.debugTill > new Date());
        let ftch = fetch
        if (fetchLogEnabled) {
            ftch = async(url, opts) => {
                return fetch(url, opts, {event});
            }
        }
        const ctx = {
            ...c,
            props: funcCtx.props,
            log,
            store,
            fetch: ftch,
        };
        return await f(ctx, events, user);
    }
};

export {wrappedFunctionChain};
`;
