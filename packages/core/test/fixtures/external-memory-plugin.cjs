"use strict";

const calls = [];

function createMemoryPlugin(ctx) {
  return {
    kind: ctx.kind,
    addLearning(_projectDir, text) {
      calls.push(`addLearning:${text}`);
    },
    addPreference(_projectDir, category, text) {
      calls.push(`addPreference:${category}:${text}`);
    },
    remove() {
      calls.push("remove");
    },
    list() {
      calls.push("list");
      return "external-list";
    },
    find(_projectDir, pattern) {
      calls.push(`find:${pattern}`);
      return "external-find";
    },
    render() {
      calls.push("render");
      return "external-render";
    },
  };
}

module.exports = {
  createMemoryPlugin,
  calls,
  resetCalls() {
    calls.length = 0;
  },
};
