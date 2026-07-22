import { EduSharingPluginApi } from '../plugin/plugin-api';
import { OptionView } from '../model/options';
import { BUILTIN_OPTION_IDS } from '../model/options';

// Adapter for the metadata-agent-canvas web component. That component does not call the
// eduSharingPlugin API itself (it communicates via attributes + postMessage), so the
// extension registers its contribution on its behalf: it REPLACES the built-in
// "Inhalt erschließen" (erschliessen) option, is visible to guests, and — since the agent
// runs its own guest-capable backend — disables the repository login requirement.
export function registerMetadataAgent(
  api: EduSharingPluginApi,
  opts: { url: string; mode: 'iframe' | 'element' }
): void {
  const view: OptionView =
    opts.mode === 'element'
      ? {
          kind: 'element',
          tag: 'metadata-agent-canvas',
          props: { layout: 'plugin', inputMode: 'url', showFloatingControls: true }
        }
      : {
          kind: 'iframe',
          url: opts.url,
          params: { mode: 'browser-extension', layout: 'plugin', inputMode: 'url' },
          passContext: true
        };

  api.registerOption({
    id: BUILTIN_OPTION_IDS.erschliessen,
    label: 'Inhalt erschließen',
    description: 'Aus der aktuellen Webseite Metadaten erzeugen',
    icon: 'erschliessen',
    bypassLogin: true,
    // Same context rule as the built-in: not on Edu-Sharing itself, not on an insert host.
    visible: (c) => !c.onEduSharing && !c.onlyOfficePresent,
    view
  });

  // The agent handles guests via its own backend → login is optional in this deployment.
  api.disableLoginRequirement();
}
