import { App } from "./App";
import { ignoreExtensionNoise, mount } from "./bootstrap";

ignoreExtensionNoise();
mount(App);
