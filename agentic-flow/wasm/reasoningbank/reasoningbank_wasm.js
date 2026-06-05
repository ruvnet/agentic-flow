/* @ts-self-types="./reasoningbank_wasm.d.ts" */
import * as wasm from "./reasoningbank_wasm_bg.wasm";
import { __wbg_set_wasm } from "./reasoningbank_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    ReasoningBankWasm, init, log
} from "./reasoningbank_wasm_bg.js";
