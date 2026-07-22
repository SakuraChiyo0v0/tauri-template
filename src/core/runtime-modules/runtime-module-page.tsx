import { createElement } from "react";

export function createRuntimeModulePage(moduleId: string, elementName: string) {
  function RuntimeModulePage() {
    return createElement(elementName, {
      "data-runtime-module": moduleId,
      className: "block min-h-full w-full",
    });
  }

  RuntimeModulePage.displayName = `RuntimeModulePage(${elementName})`;
  return RuntimeModulePage;
}
