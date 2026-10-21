// The setup program's window (cmd/setup): the app's own look, light or dark like the system.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import { mount } from 'svelte';
import Setup from './Setup.svelte';

const light = window.matchMedia('(prefers-color-scheme: light)');
const apply = () => (document.documentElement.dataset.theme = light.matches ? 'light' : 'dark');
apply();
light.addEventListener('change', apply);
mount(Setup, { target: document.getElementById('app')! });
