import { App } from "./App";
import { installRecovery, mount } from "./bootstrap";

installRecovery();
mount(App);
