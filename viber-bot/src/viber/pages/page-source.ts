/**
 * Shared parsing of Appium's `getPageSource()` hierarchy dump.
 *
 * Every roundtrip to the device costs a WebDriver call, so the pages that need
 * more than one fact about the current screen take a single snapshot and read
 * it here rather than querying element by element.
 */

import { XMLParser } from 'fast-xml-parser';

export interface XmlNode {
  node?: XmlNode | XmlNode[];
  text?: string;
  'resource-id'?: string;
  'content-desc'?: string;
  class?: string;
  bounds?: string;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
});

/** Parses one hierarchy dump and returns its root node. */
export function parseHierarchy(xml: string): XmlNode {
  const document = xmlParser.parse(xml) as { hierarchy?: XmlNode };
  const root = document.hierarchy;
  if (root === undefined) throw new Error('Appium page source has no hierarchy root.');
  return root;
}

export function childNodes(node: XmlNode): XmlNode[] {
  const children: XmlNode[] = [];
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) children.push(item as XmlNode);
        }
      } else {
        children.push(value as XmlNode);
      }
    }
  }
  return children;
}

export function findDescendant(node: XmlNode, resourceId: string): XmlNode | undefined {
  if (node['resource-id'] === resourceId) return node;
  for (const child of childNodes(node)) {
    const match = findDescendant(child, resourceId);
    if (match !== undefined) return match;
  }
  return undefined;
}

export function collectDescendants(node: XmlNode, resourceId: string, target: XmlNode[]): void {
  if (node['resource-id'] === resourceId) target.push(node);
  for (const child of childNodes(node)) collectDescendants(child, resourceId, target);
}

/** Every node in the tree, in document order. */
export function collectAll(node: XmlNode, target: XmlNode[]): void {
  target.push(node);
  for (const child of childNodes(node)) collectAll(child, target);
}

export function parseBounds(value: string | undefined): Bounds | null {
  const match = /^\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]$/.exec(value ?? '');
  if (match === null) return null;
  return {
    left: Number.parseInt(match[1] ?? '', 10),
    top: Number.parseInt(match[2] ?? '', 10),
    right: Number.parseInt(match[3] ?? '', 10),
    bottom: Number.parseInt(match[4] ?? '', 10),
  };
}

export function centerOf(bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}
