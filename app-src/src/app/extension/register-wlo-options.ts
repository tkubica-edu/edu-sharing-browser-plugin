import { EduSharingExtensionApi } from './extension.model';

/**
 * The hardcoded option set contributed by the wlo bundle.
 *
 * Called by ExtensionService once the bundle has loaded AND its element is defined, so the
 * tag below is upgradeable the moment an option references it. The bundle itself does not
 * self-register (it only *provides* the element), so the registration lives here.
 *
 * To contribute more of the bundle's elements, add further
 * `registerOption` / `registerRendering` pairs — or let the bundle call
 * `window.eduSharingExtension.*` itself (see README).
 */
export const WLO_ELEMENT_TAG = 'metadata-agent-canvas';

export function registerWloOptions(api: EduSharingExtensionApi): void {
  // Custom elements don't need a repository session — make the option reachable at once.
  api.setLoginRequired(false);

  api.registerOption({
    id: 'wlo-metadata-agent',
    label: 'WLO Metadaten-Agent',
    description: 'Rendert das Web-Component-Element des wlo-Bundles als eigenen Screen',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.8 ' +
      '5.7 21l2.3-7.1-6-4.5h7.6z"/></svg>',
    visible: () => true,
  });

  api.registerRendering({ optionId: 'wlo-metadata-agent', slot: 'screen', element: WLO_ELEMENT_TAG });
}
