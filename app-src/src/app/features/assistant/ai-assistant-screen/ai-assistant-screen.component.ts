import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';

/** The chat element the boerdi bundle defines, awaited before it is rendered. */
const CHAT_TAG = 'boerdi-chat';

// "Boerdi - KI-Assistent", entered from the offer above the session bar (AiAssistantBarComponent): the
// assistant's own chat widget, embedded as the real custom element its bundle defines. It fills the screen
// on its own — frameless, so it draws no floating button of its own, and expanded, since being here is
// already the request to chat.
@Component({
  selector: 'es-ai-assistant-screen',
  templateUrl: './ai-assistant-screen.component.html',
  styleUrl: './ai-assistant-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiAssistantScreenComponent {
  protected readonly bundle = loadWebComponentBundle('boerdi', CHAT_TAG);
}
