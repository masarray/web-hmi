import { bootstrapApplication } from '@angular/platform-browser';
import { EditorComponent } from './app/editor/editor.component';
bootstrapApplication(EditorComponent).catch((error: unknown) => console.error('HMI Studio startup error',error));
