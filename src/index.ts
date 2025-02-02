import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { GUI } from "dat.gui"

// 1. 기본 상수 설정
const G = 1                              // 중력 상수 (임의 단위)
const scaleAU = 20                       // 1 AU를 20 시뮬레이션 단위로 환산
let sunMass = 3161.4                     // 태양 질량 (지구 궤도 주기가 약 10초가 되도록 설정)

// 2. 씬, 카메라, 렌더러 생성 및 설정
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

// 3. OrbitControls와 조명 추가
const controls = new OrbitControls(camera, renderer.domElement)
scene.add(new THREE.AmbientLight(0xffffff, 0.3))
const sunLight = new THREE.PointLight(0xffffff, 1.5, 10000)
sunLight.position.set(0, 0, 0)
scene.add(sunLight)

// 4. 배경 별(스타필드) 생성 – 실제 3D 좌표상에 멀리 떨어진 별들을 생성하여 밝기 차이를 줌
function createStarField(count: number, radiusMin: number, radiusMax: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions: number[] = []
  const colors: number[] = []
  for (let i = 0; i < count; i++){
    // 구면 좌표계로 무작위 방향 생성
    const theta = Math.acos(THREE.MathUtils.randFloatSpread(2))  // 0 ~ π
    const phi = THREE.MathUtils.randFloat(0, Math.PI * 2)          // 0 ~ 2π
    // 반지름을 radiusMin~radiusMax 사이에서 랜덤 선택
    const r = THREE.MathUtils.lerp(radiusMin, radiusMax, Math.random())
    const x = r * Math.sin(theta) * Math.cos(phi)
    const y = r * Math.sin(theta) * Math.sin(phi)
    const z = r * Math.cos(theta)
    positions.push(x, y, z)
    // 별마다 밝기를 다르게 (0.5~1.0)
    const brightness = THREE.MathUtils.randFloat(0.5, 1.0)
    colors.push(brightness, brightness, brightness)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({ size: 1.5, vertexColors: true })
  return new THREE.Points(geometry, material)
}
const starField = createStarField(5000, 1000, 3000)
scene.add(starField)

// 5. 태양 Mesh 생성 및 attractor 설정 (행성들은 태양 중력에 의해 운동)
const sunGeo = new THREE.SphereGeometry(5, 32, 32)
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
const sunMesh = new THREE.Mesh(sunGeo, sunMat)
scene.add(sunMesh)
const sunAttractor = { mass: () => sunMass, position: sunMesh.position }
 
// 6. PlanetConfig 인터페이스 정의 – 각 행성(및 위성)의 초기 설정값
interface PlanetConfig {
  name: string
  color: number
  mass: number
  size: number
  rotationPeriod: number    // 자전 주기
  initialPosition: THREE.Vector3
  initialVelocity: THREE.Vector3
  attractor: { mass: () => number, position: THREE.Vector3 }
}

// 7. 텍스트 스프라이트 생성 함수 – 캔버스로 텍스트를 그려 Sprite를 생성 (행성 이름 표시용)
function createTextSprite(message: string, parameters = {}): THREE.Sprite {
  const fontface = parameters.hasOwnProperty("fontface") ? parameters["fontface"] : "Arial"
  const fontsize = parameters.hasOwnProperty("fontsize") ? parameters["fontsize"] : 24
  const borderThickness = parameters.hasOwnProperty("borderThickness") ? parameters["borderThickness"] : 4
  const borderColor = parameters.hasOwnProperty("borderColor") ? parameters["borderColor"] : { r:0, g:0, b:0, a:1.0 }
  const backgroundColor = parameters.hasOwnProperty("backgroundColor") ? parameters["backgroundColor"] : { r:255, g:255, b:255, a:1.0 }
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")!
  context.font = fontsize + "px " + fontface
  const metrics = context.measureText(message)
  const textWidth = metrics.width
  canvas.width = textWidth + borderThickness * 2
  canvas.height = fontsize + borderThickness * 2
  context.font = fontsize + "px " + fontface
  context.fillStyle = "rgba(" + backgroundColor.r + "," + backgroundColor.g + "," + backgroundColor.b + "," + backgroundColor.a + ")"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = "rgba(" + borderColor.r + "," + borderColor.g + "," + borderColor.b + "," + borderColor.a + ")"
  context.lineWidth = borderThickness
  context.strokeRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "rgba(0, 0, 0, 1.0)"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(message, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.scale.set(canvas.width / 10, canvas.height / 10, 1)
  return sprite
}

// 8. Planet 클래스 – 행성(및 위성)의 공전, 자전, 트레일(자취) 그리고 이름 레이블 구현
class Planet {
  name: string
  mass: number
  size: number
  color: number
  rotationPeriod: number
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  attractor: { mass: () => number, position: THREE.Vector3 }
  sizeMultiplier: number = 1         // GUI로 크기 조절 시 사용
  trailDuration: number = 5          // 트레일 남는 시간(초)
  trailPoints: { pos: THREE.Vector3, time: number }[] = []
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.ShaderMaterial
  trailLine: THREE.Line
  label: THREE.Sprite               // 행성 이름 표시 Sprite

  constructor(cfg: PlanetConfig) {
    this.name = cfg.name
    this.mass = cfg.mass
    this.size = cfg.size
    this.color = cfg.color
    this.rotationPeriod = cfg.rotationPeriod
    this.attractor = cfg.attractor
    // 행성 Mesh 생성 (구체)
    const geo = new THREE.SphereGeometry(this.size, 32, 32)
    const mat = new THREE.MeshPhongMaterial({ color: this.color })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.position.copy(cfg.initialPosition)
    this.velocity = cfg.initialVelocity.clone()
    scene.add(this.mesh)

    // 행성 이름을 표시하는 레이블 생성 및 행성 위에 부착 (y축으로 약간 올림)
    this.label = createTextSprite(this.name, { fontsize: 24 })
    this.label.position.set(0, this.size * 1.5, 0)
    this.mesh.add(this.label)

    // 트레일(자취)용 BufferGeometry와 custom shader material 생성
    this.trailGeometry = new THREE.BufferGeometry()
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
    // 중력에 따른 가속도 계산 및 속도/위치 업데이트
    const rVec = new THREE.Vector3().subVectors(this.attractor.position, this.mesh.position)
    const r = rVec.length()
    if (r > 0.001) {
      rVec.normalize()
      const aMag = G * this.attractor.mass() / (r * r)
      const acceleration = rVec.multiplyScalar(aMag)
      this.velocity.add(acceleration.multiplyScalar(delta * speed))
    }
    this.mesh.position.add(this.velocity.clone().multiplyScalar(delta * speed))
    // 자전 (rotationPeriod에 따른 y축 회전)
    this.mesh.rotation.y += (2 * Math.PI / this.rotationPeriod) * delta * speed
    // GUI에서 조절한 sizeMultiplier 반영
    this.mesh.scale.set(this.sizeMultiplier, this.sizeMultiplier, this.sizeMultiplier)

    // 트레일(자취) 업데이트 – 현재 위치와 시간 기록, 오래된 포인트는 제거
    const currentTime = performance.now() / 1000
    this.trailPoints.push({ pos: this.mesh.position.clone(), time: currentTime })
    this.trailPoints = this.trailPoints.filter(point => (currentTime - point.time) <= this.trailDuration)
    const positions: number[] = []
    const alphas: number[] = []
    for (let point of this.trailPoints) {
      positions.push(point.pos.x, point.pos.y, point.pos.z)
      const alpha = 1 - ((currentTime - point.time) / this.trailDuration)
      alphas.push(alpha)
    }
    const posAttr = new THREE.Float32BufferAttribute(positions, 3)
    const alphaAttr = new THREE.Float32BufferAttribute(alphas, 1)
    this.trailGeometry.setAttribute('position', posAttr)
    this.trailGeometry.setAttribute('aAlpha', alphaAttr)
    this.trailGeometry.setDrawRange(0, this.trailPoints.length)
  }
}

// 9. 실제 행성 데이터 (수, 금, 지, 화, 목, 토, 천, 해, 명)
// 거리(AU), 색상, 시각적 크기, 질량, 자전주기를 정의 (단위는 축소됨)
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
  // r = distanceAU * scaleAU (시뮬레이션 단위)
  const r = data.distanceAU * scaleAU
  // 초기 위치: x축 양의 방향
  const position = new THREE.Vector3(r, 0, 0)
  // 원형 궤도 속도: v = √(sunMass/r)
  const v = Math.sqrt(sunMass / r)
  // 초기 속도: 태양 주위를 반시계 방향 (x축 위치에서 z축 양의 방향)
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

// 10. 달 생성 – 지구 주변 궤도 (지구를 attractor로 사용)
// 지구에서 오른쪽으로 3 단위 떨어진 곳, 원형 궤도 속도 v = √(earth.mass/moonDistance) 적용
const earth = planets.find(p => p.name === "Earth")
if (earth) {
  const moonDistance = 3
  const moonPosition = earth.mesh.position.clone().add(new THREE.Vector3(moonDistance, 0, 0))
  const vMoon = Math.sqrt(earth.mass / moonDistance)
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

// 11. dat.GUI 설정 – 시뮬레이션 속도, 태양 질량, 각 행성의 색상 및 크기 조절 패널 제공
const gui = new GUI({ width: 300 })
const settings = { simulationSpeed: 1, sunMass: sunMass }
gui.add(settings, "simulationSpeed", 0, 5, 0.1)
gui.add(settings, "sunMass", 1000, 5000, 1).onChange((v: number) => { sunMass = v })
planets.forEach(planet => {
  const folder = gui.addFolder(planet.name)
  folder.addColor({ color: planet.color }, "color").onChange((v: number|string) => {
    planet.mesh.material.color.set(v)
    planet.trailMaterial.uniforms.uColor.value.set(v)
  })
  folder.add(planet, "sizeMultiplier", 1, 5, 0.1)
})

// 12. 애니메이션 루프 – 각 프레임마다 행성의 운동, 자전, 트레일 업데이트 및 렌더링
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
