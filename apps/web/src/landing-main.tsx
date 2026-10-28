import { installRecovery, mount } from "./bootstrap";
import { Landing } from "./routes/Landing";

installRecovery();
mount(Landing);
