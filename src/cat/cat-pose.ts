/** 고양이 자세를 숫자로 계산해요. 화면과 상관없는 순수 함수이고, 미리 만든 CatPose에 값을 써요. */

export interface CatPose {
  /** 몸 전체를 낮추는 높이예요. */
  bodyLower: number;
  /** 몸의 앞쪽을 드는 각도예요. 음수이면 앞이 들려요. */
  bodyPitch: number;
  headPitch: number;
  legFrontLeft: number;
  legFrontRight: number;
  legBackLeft: number;
  legBackRight: number;
  /** 눈을 뜬 정도예요. 1이면 다 떠요. */
  eyeOpen: number;
}

export interface CatPoseInput {
  walkPhase: number;
  walkWeight: number;
  /** 0~1 값이에요. 앉은 자세의 정도예요. */
  sit: number;
  /** 0~1 값이에요. 웅크린 자세의 정도예요. */
  curl: number;
  lookUp: number;
  blink: number;
  /** 0~1 값이에요. 코를 맞대려고 고개를 내민 정도예요. */
  nose: number;
}

const WALK_LEG_SWING = 0.55;
const SIT_PITCH = -0.62;
const SIT_LOWER = 0.055;
const SIT_FRONT_LEG = 0.62;
const SIT_BACK_LEG = -1.15;
const CURL_LOWER = 0.098;
const CURL_HEAD = 0.42;
/** 웅크리면 앞다리는 뒤로, 뒷다리는 앞으로 접어 몸 아래에 넣어요. */
const CURL_FRONT_LEG = 1.45;
const CURL_BACK_LEG = -1.45;
const LOOK_UP_HEAD = -0.5;
const NOSE_HEAD = 0.3;
const CLOSED_EYE = 0.1;

/** 눈을 한 번 천천히 감았다 뜨는 시간이에요. */
const BLINK_SECONDS = 1.8;
/** 고개를 들고 눈을 깜빡이는 동작 전체 시간이에요. */
export const CAT_NOTICE_SECONDS = 2.6;

export function createCatPose(): CatPose {
  return {
    bodyLower: 0,
    bodyPitch: 0,
    headPitch: 0,
    legFrontLeft: 0,
    legFrontRight: 0,
    legBackLeft: 0,
    legBackRight: 0,
    eyeOpen: 1,
  };
}

/** 깜빡이기 시작한 뒤 눈이 감긴 정도예요. 천천히 감았다 천천히 떠요. */
export function blinkAmount(seconds: number): number {
  if (seconds <= 0 || seconds >= BLINK_SECONDS) return 0;
  return Math.sin((seconds / BLINK_SECONDS) * Math.PI);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function composeCatPose(out: CatPose, input: CatPoseInput): CatPose {
  const { walkPhase, walkWeight, sit, curl, lookUp, blink, nose } = input;
  const swing = Math.sin(walkPhase) * WALK_LEG_SWING * walkWeight;

  out.bodyLower = 0;
  out.bodyPitch = 0;
  out.headPitch = 0;
  // 고양이는 대각선 다리가 함께 움직여요.
  out.legFrontLeft = swing;
  out.legBackRight = swing;
  out.legFrontRight = -swing;
  out.legBackLeft = -swing;

  if (sit > 0) {
    out.bodyLower = mix(out.bodyLower, SIT_LOWER, sit);
    out.bodyPitch = mix(out.bodyPitch, SIT_PITCH, sit);
    out.headPitch = mix(out.headPitch, -SIT_PITCH * 0.75, sit);
    out.legFrontLeft = mix(out.legFrontLeft, SIT_FRONT_LEG, sit);
    out.legFrontRight = mix(out.legFrontRight, SIT_FRONT_LEG, sit);
    out.legBackLeft = mix(out.legBackLeft, SIT_BACK_LEG, sit);
    out.legBackRight = mix(out.legBackRight, SIT_BACK_LEG, sit);
  }
  if (curl > 0) {
    out.bodyLower = mix(out.bodyLower, CURL_LOWER, curl);
    out.bodyPitch = mix(out.bodyPitch, 0, curl);
    out.headPitch = mix(out.headPitch, CURL_HEAD, curl);
    out.legFrontLeft = mix(out.legFrontLeft, CURL_FRONT_LEG, curl);
    out.legFrontRight = mix(out.legFrontRight, CURL_FRONT_LEG, curl);
    out.legBackLeft = mix(out.legBackLeft, CURL_BACK_LEG, curl);
    out.legBackRight = mix(out.legBackRight, CURL_BACK_LEG, curl);
  }
  out.headPitch = mix(out.headPitch, NOSE_HEAD, nose);
  out.headPitch = mix(out.headPitch, LOOK_UP_HEAD, lookUp);
  out.eyeOpen = mix(1, CLOSED_EYE, blink);
  return out;
}
