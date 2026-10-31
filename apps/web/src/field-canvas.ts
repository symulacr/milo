/**
 * Proof-well field: three assets react to pointer + scroll.
 * Prefers WebGPU (three/webgpu), falls back to WebGL, skips on reduced motion.
 */
import {
  ClampToEdgeWrapping,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from "three";

/** Primary wells + scroll-reactive depth plates (multi-asset, not one still). */
const SRC = [
  "/images/hero.webp",
  "/images/detail.webp",
  "/images/collection.webp",
  "/images/proof-review.webp",
  "/images/packing.webp",
] as const;

type FieldRenderer = {
  setPixelRatio: (n: number) => void;
  setSize: (w: number, h: number, updateStyle?: boolean) => void;
  render: (scene: Scene, camera: PerspectiveCamera) => void;
  dispose: () => void;
};

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function createRenderer(
  canvas: HTMLCanvasElement,
): Promise<FieldRenderer | null> {
  try {
    const { WebGPURenderer } = await import("three/webgpu");
    const gpu = new WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    await gpu.init();
    return gpu;
  } catch {
    try {
      return new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      return null;
    }
  }
}

export function mountFieldCanvas(host: HTMLElement): () => void {
  if (reduced()) return () => {};

  const canvas = document.createElement("canvas");
  canvas.className = "field-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);

  let alive = true;
  let raf = 0;
  let renderer: FieldRenderer | null = null;
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.z = 4.2;
  const geo = new PlaneGeometry(1.05, 1.4, 1, 1);
  const planes: Mesh[] = [];
  const loader = new TextureLoader();
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let scroll = 0;
  const t0 = performance.now();

  SRC.forEach((url, i) => {
    const front = i < 3;
    const mat = new MeshBasicMaterial({
      transparent: true,
      opacity: front ? 0.92 : 0.55,
    });
    const mesh = new Mesh(geo, mat);
    if (front) {
      mesh.position.set((i - 1) * 1.2, 0, 0);
    } else {
      // Depth plates: sit behind the wells and drift more with scroll.
      mesh.position.set((i === 3 ? -0.55 : 0.55) * 1.6, 0.15, -1.1);
      mesh.scale.setScalar(0.72);
    }
    scene.add(mesh);
    planes.push(mesh);
    loader.load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
      mat.map = tex;
      mat.needsUpdate = true;
    });
  });

  const size = () => {
    if (!renderer) return;
    const { width, height } = host.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };

  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onScroll = () => {
    scroll = Math.min(1, Math.max(0, scrollY / Math.max(innerHeight, 1)));
  };

  const tick = (now: number) => {
    if (!alive || !renderer) return;
    const wave = (now - t0) / 1000;
    pointer.x += (target.x - pointer.x) * 0.08;
    pointer.y += (target.y - pointer.y) * 0.08;
    planes.forEach((mesh, i) => {
      const front = i < 3;
      const drift = (i - 1) * 0.12;
      const bob = Math.sin(wave * 1.1 + i * 1.7) * (front ? 0.03 : 0.05);
      const lean = front ? 0.22 : 0.35;
      mesh.rotation.y =
        pointer.x * lean + drift * scroll + Math.sin(wave * 0.4 + i) * 0.04;
      mesh.rotation.x = pointer.y * -0.14 + Math.cos(wave * 0.35 + i) * 0.02;
      if (front) {
        mesh.position.x =
          (i - 1) * (1.2 - scroll * 0.08) + pointer.x * 0.04 * (i - 1);
        mesh.position.y =
          pointer.y * 0.1 + bob + Math.sin(scroll * Math.PI + i) * 0.05;
        mesh.position.z = -scroll * 0.45 + Math.sin(wave * 0.6 + i) * 0.02;
      } else {
        const side = i === 3 ? -1 : 1;
        mesh.position.x =
          side * (1.05 + scroll * 0.25) + pointer.x * 0.12 * side;
        mesh.position.y = 0.12 + bob + pointer.y * 0.14 - scroll * 0.2;
        mesh.position.z = -1.1 - scroll * 0.9 + Math.sin(wave * 0.5 + i) * 0.04;
      }
    });
    camera.position.x = pointer.x * 0.18;
    camera.position.y = pointer.y * 0.1 + scroll * 0.05;
    camera.position.z = 4.2 - scroll * 0.35;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const onResize = () => size();

  void createRenderer(canvas).then((created) => {
    if (!alive) {
      created?.dispose();
      return;
    }
    if (!created) {
      canvas.remove();
      return;
    }
    renderer = created;
    size();
    onScroll();
    host.addEventListener("pointermove", onPointer, { passive: true });
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    raf = requestAnimationFrame(tick);
  });

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    host.removeEventListener("pointermove", onPointer);
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onResize);
    geo.dispose();
    for (const mesh of planes) {
      const mat = mesh.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    renderer?.dispose();
    canvas.remove();
  };
}
