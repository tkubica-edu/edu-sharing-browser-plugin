// Which fields of a metadata set a form actually shows, and which of those the repository can generate.
// A set describes far more than one form renders: its widgets are the whole vocabulary, and a group picks
// the views — and with them the widgets — a form is built from. Everything here works off the group, so a
// generation run is asked for exactly the fields the person in front of the form can see.

import { MdsDefinition, MdsWidget } from 'ngx-edu-sharing-api';

/** One widget of a generation run, in the shape the suggestion API takes it (`WidgetAiConfigInfo`). */
export interface WidgetAiConfig {
  widgetId: string;
  aiConfigId: string;
}

/**
 * The `aiConfig` a widget is generated under, as the MDS editor asks for it: the one named `default` —
 * the only one the editor ever asks for — else the first the widget offers, and that name again for a
 * config that states none. Null for a widget that carries no config at all, which is the answer for a
 * field the repository cannot generate.
 */
const DEFAULT_AI_CONFIG = 'default';

/**
 * The widgets a form is built from, in the order the views name them: every element of a view's html whose
 * tag is a widget of the set. A group naming no view — an id the set does not know — yields nothing rather
 * than the set's whole vocabulary.
 *
 * Where a set defines a widget once per template, the definition of the view being rendered wins, then the
 * one that names no template — the same order the editor resolves a widget in.
 */
export function formWidgets(set: MdsDefinition, groupId: string): MdsWidget[] {
  const views = set.groups?.find((group) => group.id === groupId)?.views ?? [];
  const widgets: MdsWidget[] = [];
  const named = new Set<string>();
  for (const viewId of views) {
    const html = set.views?.find((view) => view.id === viewId)?.html ?? '';
    for (const widgetId of referencedIds(html)) {
      if (named.has(widgetId)) continue;
      const widget = definitionOf(set, widgetId, viewId);
      if (!widget) continue;
      named.add(widgetId);
      widgets.push(widget);
    }
  }
  return widgets;
}

/**
 * The fields of a form a generation run can fill: its widgets carrying an `aiConfig`, minus the ones
 * `settled` already answers — those are what a run works *from*, not what it is asked for.
 */
export function aiConfigWidgets(
  set: MdsDefinition,
  groupId: string,
  settled: readonly string[] = [],
): WidgetAiConfig[] {
  return aiConfigBreakdown(set, groupId, settled).generatable;
}

/** What a form's fields amount to for a generation run: the ones it is asked for, and why the rest are not. */
export interface AiConfigBreakdown {
  /** The fields a run is asked for — see {@link aiConfigWidgets}. */
  generatable: WidgetAiConfig[];
  /** Fields the set can generate that a value handed to the run already answers. */
  answered: string[];
  /** Fields of the form the set names no `aiConfig` for — the ones no run can fill. */
  withoutAiConfig: string[];
}

/**
 * The same reading of a form as {@link aiConfigWidgets}, with what it leaves out named: which of the
 * form's fields the metadata set can generate, which of those a run is given an answer for, and which
 * the set describes no generation for at all.
 */
export function aiConfigBreakdown(
  set: MdsDefinition,
  groupId: string,
  settled: readonly string[] = [],
): AiConfigBreakdown {
  const breakdown: AiConfigBreakdown = { generatable: [], answered: [], withoutAiConfig: [] };
  for (const widget of formWidgets(set, groupId)) {
    const widgetId = widget.id;
    if (!widgetId) continue;
    const aiConfigId = aiConfigOf(widget);
    if (!aiConfigId) breakdown.withoutAiConfig.push(widgetId);
    else if (settled.includes(widgetId)) breakdown.answered.push(widgetId);
    else breakdown.generatable.push({ widgetId, aiConfigId });
  }
  return breakdown;
}

/**
 * Every field the metadata set describes a generation for, whatever form shows it: the whole vocabulary's
 * widgets carrying an `aiConfig`, each named once. What a run can be asked for at most — a form built from
 * a group offers the part of it that group renders (see {@link aiConfigBreakdown}).
 */
export function aiConfigFields(set: MdsDefinition): WidgetAiConfig[] {
  const fields: WidgetAiConfig[] = [];
  const named = new Set<string>();
  for (const widget of set.widgets ?? []) {
    const widgetId = widget.id;
    if (!widgetId || named.has(widgetId)) continue;
    const aiConfigId = aiConfigOf(widget);
    if (!aiConfigId) continue;
    named.add(widgetId);
    fields.push({ widgetId, aiConfigId });
  }
  return fields;
}

/** See {@link DEFAULT_AI_CONFIG}. */
function aiConfigOf(widget: MdsWidget): string | null {
  const configs = widget.aiConfigs ?? [];
  if (!configs.length) return null;
  const named = configs.find((config) => config.id === DEFAULT_AI_CONFIG);
  return named?.id ?? configs[0].id ?? DEFAULT_AI_CONFIG;
}

/**
 * The widget ids a view's html refers to, in document order: a view places a widget by using its id as an
 * element (`<cclom:title></cclom:title>`), among the layout elements it is arranged with. Read as text
 * rather than parsed, because a namespaced tag is no valid html element and a parser rearranges the
 * markup around it; the layout's own tags are sorted out by {@link definitionOf}, which knows the set.
 */
function referencedIds(html: string): string[] {
  return [...html.matchAll(/<\s*([A-Za-z][\w.:-]*)/g)].map((match) => match[1]);
}

/** The set's definition of one widget for one view — see {@link formWidgets}; null for a tag that is none. */
function definitionOf(set: MdsDefinition, widgetId: string, viewId: string): MdsWidget | null {
  const candidates = (set.widgets ?? []).filter((widget) => widget.id === widgetId);
  return (
    candidates.find((widget) => widget.template?.includes(viewId)) ??
    candidates.find((widget) => !widget.template?.length) ??
    candidates[0] ??
    null
  );
}
