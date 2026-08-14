import { ChangeDetectionStrategy, Component } from '@angular/core';

// "Boerdi - KI-Assistent", entered from the offer above the session bar (AiAssistantBarComponent).
//
// A placeholder for now: the view the assistant is actually asked in is supplied later, and nothing
// here talks to it. It exists so the offer has somewhere to lead — see the `ai-assistant` section in
// the navigation registry.
@Component({
  selector: 'es-ai-assistant-screen',
  templateUrl: './ai-assistant-screen.component.html',
  styleUrl: './ai-assistant-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiAssistantScreenComponent {}
