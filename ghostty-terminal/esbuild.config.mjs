import * as fs from "node:fs";
import * as path from "node:path";
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const isProd = process.env.NODE_ENV === "production";

// Extension bundle (Node.js, CommonJS)
const extensionConfig = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "out/extension.js",
	platform: "node",
	external: ["vscode", "node-pty"], // Don't bundle native module
	format: "cjs",
	sourcemap: !isProd,
	minify: isProd,
	target: "node18",
};

// Webview bundle (browser, IIFE)
const webviewConfig = {
	entryPoints: ["src/webview/main.ts"],
	bundle: true,
	outfile: "out/webview/main.js",
	platform: "browser",
	format: "iife",
	sourcemap: !isProd,
	minify: isProd,
	target: "es2022",
};

async function build() {
	try {
		// Build extension
		if (isWatch) {
			const extensionCtx = await esbuild.context(extensionConfig);
			await extensionCtx.watch();
			console.log("[esbuild] Watching extension...");
		} else {
			await esbuild.build(extensionConfig);
			console.log("[esbuild] Extension built.");
		}

		// Build webview (if entry exists)
		const webviewEntry = path.join(process.cwd(), "src/webview/main.ts");
		if (fs.existsSync(webviewEntry)) {
			if (isWatch) {
				const webviewCtx = await esbuild.context(webviewConfig);
				await webviewCtx.watch();
				console.log("[esbuild] Watching webview...");
			} else {
				await esbuild.build(webviewConfig);
				console.log("[esbuild] Webview built.");
			}
		} else {
			console.log("[esbuild] Webview entry not found, skipping webview build.");
		}

		// Copy static files
		const templateSrc = path.join(process.cwd(), "src/webview/template.html");
		const stylesSrc = path.join(process.cwd(), "src/webview/styles.css");
		const outWebview = path.join(process.cwd(), "out/webview");

		function copyStaticFiles() {
			if (!fs.existsSync(outWebview)) {
				fs.mkdirSync(outWebview, { recursive: true });
			}
			if (fs.existsSync(templateSrc)) {
				fs.copyFileSync(templateSrc, path.join(outWebview, "template.html"));
			}
			if (fs.existsSync(stylesSrc)) {
				fs.copyFileSync(stylesSrc, path.join(outWebview, "styles.css"));
			}
		}

		copyStaticFiles();
		console.log("[esbuild] Static files copied.");

		// Watch static files in dev mode
		if (isWatch) {
			fs.watch(path.dirname(templateSrc), (_eventType, filename) => {
				if (filename === "template.html" || filename === "styles.css") {
					copyStaticFiles();
					console.log(`[esbuild] Static file ${filename} updated.`);
				}
			});
		}
	} catch (error) {
		console.error("[esbuild] Build failed:", error);
		process.exit(1);
	}
}

build();
