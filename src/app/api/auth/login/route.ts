import { handle, HttpError, json, readJson } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { issueNewSession } from "@/lib/auth/session";
import { ensureDefaultAdmin } from "@/lib/auth/bootstrap";
import { validateLoginPassword, validateUsername } from "@/lib/security/validate";
import {
  clearLoginFailures,
  getLockRemainingSeconds,
  recordLoginFailure,
} from "@/lib/auth/rateLimit";

const LOCKED_MESSAGE = (seconds: number) =>
  `로그인을 5회 실패하여 잠시 차단되었습니다. ${Math.ceil(seconds / 60)}분 후에 다시 시도해 주세요.`;

export const POST = handle(async (req) => {
  const body = await readJson(req);

  // [NoSQL Injection 1차 차단] 아이디/비밀번호가 문자열이 아니면(예: {"$ne": null}) 400 으로 거절한다.
  const username = validateUsername(body.username);
  const password = validateLoginPassword(body.password);

  // [무작위 대입 차단] 이미 잠긴 아이디라면 비밀번호 검사조차 하지 않고 거절
  const lockedFor = await getLockRemainingSeconds(username);
  if (lockedFor > 0) throw new HttpError(429, LOCKED_MESSAGE(lockedFor));

  await connectDB();
  // admin 로 로그인하려는데 관리자 계정이 아직 없으면 먼저 만들어 둔다. (seed 를 안 해도 로그인 가능)
  if (username === "admin") await ensureDefaultAdmin();
  const user = await User.findOne({ username }).select("+passwordHash");

  // 아이디가 없어도 bcrypt 비교를 똑같이 수행 (응답 시간으로 가입 여부를 추측하지 못하게)
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok) {
    const { locked, remaining } = await recordLoginFailure(username);
    if (locked) throw new HttpError(429, LOCKED_MESSAGE(5 * 60));
    // 아이디 존재 여부와 상관없이 항상 같은 문구를 사용
    throw new HttpError(401, `아이디 또는 비밀번호가 올바르지 않습니다. (남은 시도 ${remaining}회)`);
  }

  await clearLoginFailures(username);

  // [세션 쿠키 보안] 로그인 성공 시마다 새 세션 토큰을 발급하고 HttpOnly 쿠키로 내려준다.
  await issueNewSession(String(user._id));

  return json({ user: { username: user.username, role: user.role } });
});