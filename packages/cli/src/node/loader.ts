// A SEA main can import() only built-in modules, and require() rejects the CLI because its dependencies use
// top-level await. The SEA main requires this module, whose import() is an ordinary one.
export const load = (url: string): Promise<unknown> => import(/* @vite-ignore */ url)
