import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { GUI } from "dat.gui"

// ---------------------- 기본 상수 및 환경 설정 ----------------------
// 중력상수 (단위는 임의로 1)
const G = 1
// 1 AU를 20 시뮬레이션 단위로 사용 (즉, 지구의 궤도 반지름 = 20)
const scaleAU = 20
// 태양 질량은 지구 궤도 주기가 약 10초가 되도록 결정 (실제 수치는 축소됨)
let sunMass = 3161.4

// 씬, 카메라, 렌더러 생성
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000000)
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 10000)
camera.position.set(0, 200, 800)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
document.body.style.margin = "0"
document.body.style.overflow = "hidden"
document.body.appendChild(renderer.domElement)
window.addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// OrbitControls 및 조명 추가
const controls = new OrbitControls(camera, renderer.domElement)
scene.add(new THREE.AmbientLight(0xffffff, 0.3))
const sunLight = new THREE.PointLight(0xffffff, 1.5, 10000)
sunLight.position.set(0, 0, 0)
scene.add(sunLight)

// 태양 생성 – 반지름 5, 노란색 Mesh
const sunGeo = new THREE.SphereGeometry(5, 32, 32)
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
const sunMesh = new THREE.Mesh(sunGeo, sunMat)
scene.add(sunMesh)
// 태양의 중력 attractor 역할 (mass와 position 제공)
const sunAttractor = { mass: () => sunMass, position: sunMesh.position }

// ---------------------- Planet 클래스 정의 ----------------------

// PlanetConfig 인터페이스 – 각 행성(또는 위성)의 초기 설정값
interface PlanetConfig {
  name: string
  color: number
  mass: number
  size: number
  rotationPeriod: number  // 자전 주기 (단위: 임의)
  initialPosition: THREE.Vector3
  initialVelocity: THREE.Vector3
  attractor: { mass: () => number, position: THREE.Vector3 }
}

// Planet 클래스 – 중력 계산, 공전·자전, 그리고 트레일(궤적)을 구현
class Planet {
  name: string
  mass: number
  size: number
  color: number
  rotationPeriod: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  attractor: { mass: () => number, position: THREE.Vector3 }
  // 행성의 크기를 키울 수 있는 multiplier (GUI 조절용)
  sizeMultiplier: number = 1
  // 트레일 관련 속성들
  trailDuration: number = 5  // 트레일이 남아있는 시간 (초)
  trailPoints: { pos: THREE.Vector3, time: number }[] = []  // 시간 기록과 함께 저장
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.ShaderMaterial
  trailLine: THREE.Line

  constructor(cfg: PlanetConfig) {
    this.name = cfg.name
    this.mass = cfg.mass
    this.size = cfg.size
    this.color = cfg.color
    this.rotationPeriod = cfg.rotationPeriod
    this.attractor = cfg.attractor
    // 행성 Mesh 생성 (구체형)
    const geo = new THREE.SphereGeometry(this.size, 32, 32)
    const mat = new THREE.MeshPhongMaterial({ color: this.color })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.position.copy(cfg.initialPosition)
    // 초기 속도 설정
    this.velocity = cfg.initialVelocity.clone()
    scene.add(this.mesh)

    // 트레일 초기화 – BufferGeometry와 custom shader material 사용
    this.trailGeometry = new THREE.BufferGeometry()
    // custom shader material: 각 정점에 aAlpha 속성을 받아 uColor와 곱하여 투명도 효과 적용
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(this.color) } },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `,
      transparent: true
    })
    this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial)
    scene.add(this.trailLine)
  }

  update(delta: number, speed: number) {
    // ---------------------- 중력 및 공전(운동) 업데이트 ----------------------
    const rVec = new THREE.Vector3().subVectors(this.attractor.position, this.mesh.position)
    const r = rVec.length()
    if(r > 0.001) {
      rVec.normalize()
      const aMag = G * this.attractor.mass() / (r * r)
      const acceleration = rVec.multiplyScalar(aMag)
      this.velocity.add(acceleration.multiplyScalar(delta * speed))
    }
    this.mesh.position.add(this.velocity.clone().multiplyScalar(delta * speed))

    // 자전 업데이트 – rotationPeriod에 따라 y축 회전
    this.mesh.rotation.y += (2 * Math.PI / this.rotationPeriod) * delta * speed

    // 행성 크기 조절 (GUI에서 조절한 sizeMultiplier 반영)
    this.mesh.scale.set(this.sizeMultiplier, this.sizeMultiplier, this.sizeMultiplier)

    // ---------------------- 트레일(궤적) 업데이트 ----------------------
    const currentTime = performance.now() / 1000
    // 현재 위치와 시간을 트레일 배열에 추가
    this.trailPoints.push({ pos: this.mesh.position.clone(), time: currentTime })
    // trailDuration보다 오래된 포인트는 제거
    this.trailPoints = this.trailPoints.filter(point => (currentTime - point.time) <= this.trailDuration)
    // 각 포인트별로 position과 alpha(투명도, 시간에 따라 감소)를 계산
    const positions: number[] = []
    const alphas: number[] = []
    for (let point of this.trailPoints) {
      positions.push(point.pos.x, point.pos.y, point.pos.z)
      const alpha = 1 - ((currentTime - point.time) / this.trailDuration)
      alphas.push(alpha)
    }
    // BufferAttribute들을 새로 생성하여 트레일 Geometry에 적용 (매 프레임 업데이트)
    const posAttr = new THREE.Float32BufferAttribute(positions, 3)
    const alphaAttr = new THREE.Float32BufferAttribute(alphas, 1)
    this.trailGeometry.setAttribute('position', posAttr)
    this.trailGeometry.setAttribute('aAlpha', alphaAttr)
    this.trailGeometry.setDrawRange(0, this.trailPoints.length)
  }
}

// ---------------------- 행성(및 위성) 생성 ----------------------

// 실제 행성 데이터 (거리 단위: AU, 크기는 시각적 크기, 질량은 궤도 안정성에만 영향)
// 순서: 수, 금, 지, 화, 목, 토, 천, 해, 명
const planetData = [
  { name: "Mercury", distanceAU: 0.387, color: 0xaaaaaa, size: 0.38, mass: 0.33, rotationPeriod: 10 },
  { name: "Venus",   distanceAU: 0.723, color: 0xffcc66, size: 0.95, mass: 4.87, rotationPeriod: 10 },
  { name: "Earth",   distanceAU: 1.0,   color: 0x2233ff, size: 1.0,  mass: 5.97, rotationPeriod: 1 },
  { name: "Mars",    distanceAU: 1.524, color: 0xff3300, size: 0.53, mass: 0.642, rotationPeriod: 1.03 },
  { name: "Jupiter", distanceAU: 5.203, color: 0xff9966, size: 2.0,  mass: 1898, rotationPeriod: 0.41 },
  { name: "Saturn",  distanceAU: 9.537, color: 0xffcc99, size: 1.8,  mass: 568, rotationPeriod: 0.45 },
  { name: "Uranus",  distanceAU: 19.191, color: 0x66ccff, size: 1.5, mass: 86.8, rotationPeriod: 0.72 },
  { name: "Neptune", distanceAU: 30.07, color: 0x3333ff, size: 1.5, mass: 102, rotationPeriod: 0.67 },
  { name: "Pluto",   distanceAU: 39.48, color: 0xaaaaaa, size: 0.3,  mass: 0.0146, rotationPeriod: 10 }
]

const planets: Planet[] = []
planetData.forEach(data => {
  // 시뮬레이션 단위: r = distanceAU * scaleAU
  const r = data.distanceAU * scaleAU
  // 초기 위치: x축 양의 방향
  const position = new THREE.Vector3(r, 0, 0)
  // 원형 궤도 속도: v = sqrt(G * sunMass / r)
  const v = Math.sqrt(sunMass / r)
  // 초기 속도: 태양 주위를 반시계 방향으로 돌도록 (x축 위치에서 z축 양의 방향)
  const velocity = new THREE.Vector3(0, 0, v)
  const planet = new Planet({
    name: data.name,
    color: data.color,
    mass: data.mass,
    size: data.size,
    rotationPeriod: data.rotationPeriod,
    initialPosition: position,
    initialVelocity: velocity,
    attractor: sunAttractor
  })
  planets.push(planet)
})

// 달 생성 – 지구 주변 궤도 (지구를 attractor로 지정)
// 실제 달-지구 거리는 매우 작으나 시각적 가독성을 위해 3 단위 사용
const earth = planets.find(p => p.name === "Earth")
if(earth) {
  const moonDistance = 3
  const moonPosition = earth.mesh.position.clone().add(new THREE.Vector3(moonDistance, 0, 0))
  // 지구 주변 원형 궤도 속도: v = sqrt(earth.mass / moonDistance)
  const vMoon = Math.sqrt(earth.mass / moonDistance)
  // 달이 지구 주위를 돌도록, 지구의 속도에 (0, 0, vMoon)를 추가
  const moonVelocity = earth.velocity.clone().add(new THREE.Vector3(0, 0, vMoon))
  const moon = new Planet({
    name: "Moon",
    color: 0x888888,
    mass: 0.073,
    size: 0.27,
    rotationPeriod: 27,
    initialPosition: moonPosition,
    initialVelocity: moonVelocity,
    attractor: { mass: () => earth.mass, position: earth.mesh.position }
  })
  planets.push(moon)
}

// ---------------------- dat.GUI 설정 ----------------------
const gui = new GUI({ width: 300 })
const settings = { simulationSpeed: 1, sunMass: sunMass }
gui.add(settings, "simulationSpeed", 0, 5, 0.1)
gui.add(settings, "sunMass", 1000, 5000, 1).onChange((v: number) => { sunMass = v })

// 각 행성별 폴더 생성 – 색상 변경 및 크기 확대용 패널 추가
planets.forEach(planet => {
  const folder = gui.addFolder(planet.name)
  folder.addColor({ color: planet.color }, "color").onChange((v: number|string) => {
    planet.mesh.material.color.set(v)
    planet.trailMaterial.uniforms.uColor.value.set(v)
  })
  folder.add(planet, "sizeMultiplier", 1, 5, 0.1)
})

// ---------------------- 애니메이션 루프 ----------------------
let lastTime = Date.now()
function animate(){
  requestAnimationFrame(animate)
  const delta = (Date.now() - lastTime) / 1000
  lastTime = Date.now()
  planets.forEach(p => p.update(delta, settings.simulationSpeed))
  controls.update()
  renderer.render(scene, camera)
}
animate()
