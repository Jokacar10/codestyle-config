"use strict";

const shared = require("./shared");

const defaultGroups = [
	// Node.js builtins prefixed with `node:`.
	["^node:"],
	// Packages.
	// Things that start with a letter (or digit or underscore), or `@` followed by a letter.
	["^@?\\w"],
	// Absolute imports and other imports such as Vue-style `@/foo`.
	// Anything not matched in another group.
	["^"],
	// Relative imports.
	// Anything that starts with a dot.
	["^\\."],
	// Side effect imports.
	["^\\u0000"],
];

// import def, { a, b as c, type d } from "A"
//               ^  ^^^^^^  ^^^^^^
const isImportSpecifier = (node) => node.type === "ImportSpecifier";

// Exclude "ImportDefaultSpecifier" – the "def" in `import def, {a, b}`.
const getSpecifiers = (importNode) =>
	importNode.specifiers.filter((node) => isImportSpecifier(node));

// Full import statement.
const isImport = (node) => node.type === "ImportDeclaration";

// import "setup"
// But not: import {} from "setup"
// And not: import type {} from "setup"
const isSideEffectImport = (importNode, sourceCode) =>
	importNode.specifiers.length === 0
	&& (!importNode.importKind || importNode.importKind === "value")
	&& !shared.isPunctuator(
		sourceCode.getFirstToken(importNode, { skip: 1 }),
		"{",
	);

module.exports = {
	meta: {
		type: "layout",
		fixable: "code",
		schema: [
			{
				type: "object",
				properties: {
					groups: {
						type: "array",
						items: {
							type: "array",
							items: {
								type: "string",
							},
						},
					},
				},
				additionalProperties: false,
			},
		],
		docs: {
			url: "https://github.com/lydell/eslint-plugin-simple-import-sort#sort-order",
		},
		messages: {
			sort: "Run autofix to sort these imports!",
		},
	},
	create: (context) => {
		const { groups: rawGroups = defaultGroups } = context.options[0] || {};

		const outerGroups = rawGroups.map((groups) =>
			groups.map((item) => new RegExp(item, "u")),
		);

		const parents = new Set();

		return {
			"ImportDeclaration": (node) => {
				parents.add(node.parent);
			},

			"Program:exit": () => {
				for (const parent of parents) {
					for (const chunk of shared.extractChunks(parent, (node) =>
						isImport(node) ? "PartOfChunk" : "NotPartOfChunk",
					)) {
						maybeReportChunkSorting(chunk, context, outerGroups);
					}
				}
				parents.clear();
			},
		};
	},
};

function maybeReportChunkSorting(chunk, context, outerGroups) {
	const sourceCode = context.sourceCode;
	const items = shared.getImportExportItems(
		chunk,
		sourceCode,
		isSideEffectImport,
		getSpecifiers,
	);
	const sortedItems = makeSortedItems(items, outerGroups);
	const sorted = shared.printSortedItems(sortedItems, items, sourceCode);
	const { start } = items[0];
	const { end } = items[items.length - 1];
	shared.maybeReportSorting(context, sorted, start, end);
}

function makeSortedItems(items, outerGroups) {
	const itemGroups = outerGroups.map((groups) =>
		groups.map((regex) => ({ regex, items: [] })),
	);
	const rest = [];

	for (const item of items) {
		const { originalSource } = item.source;
		const source = item.isSideEffectImport
			? `\0${originalSource}`
			: item.source.kind === "value"
				? originalSource
				: `${originalSource}\0`;
		const [matchedGroup] = shared
			// eslint-disable-next-line unicorn/no-array-method-this-argument
			.flatMap(itemGroups, (groups) =>
				groups.map((group) => [group, group.regex.exec(source)]),
			)
			.reduce(
				([group, longestMatch], [nextGroup, nextMatch]) =>
					nextMatch != null
					&& (longestMatch == null
						|| nextMatch[0].length > longestMatch[0].length)
						? [nextGroup, nextMatch]
						: [group, longestMatch],
				[undefined, undefined],
			);
		if (matchedGroup == null) {
			rest.push(item);
		} else {
			matchedGroup.items.push(item);
		}
	}

	return [...itemGroups, [{ regex: /^/, items: rest }]]
		.map((groups) => groups.filter((group) => group.items.length > 0))
		.filter((groups) => groups.length > 0)
		.map((groups) =>
			groups.map((group) => shared.sortImportExportItems(group.items)),
		);
}
