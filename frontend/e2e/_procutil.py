"""e2e 공용 — 프리뷰/서버 자식 프로세스 '트리째' 종료.

문제: Popen(shell=True)의 pid는 셸이라 terminate()로는 npm/node 자식이 고아로 살아남는다.
  - Windows: taskkill /T 로 트리 종료 (일부 스위트만 적용돼 있던 것을 공용화)
  - 리눅스/맥: 셸만 죽고 vite preview(node)가 누적 → 포트 점유·메모리 누수 실측(44개)
해법: 스폰 시 새 세션(start_new_session)으로 띄우고, 종료 시 프로세스 그룹 전체에 시그널.

사용:
    from _procutil import SPAWN_KW, stop_tree
    server = subprocess.Popen(..., **SPAWN_KW)
    ...
    stop_tree(server)
"""
import os
import signal
import subprocess

# POSIX: 새 세션 = 새 프로세스 그룹(pgid == pid) → 그룹 시그널로 셸+node 일괄 종료 가능.
# Windows에선 start_new_session이 무시되므로 그대로 넘겨도 안전하다.
SPAWN_KW = {"start_new_session": True}


def stop_tree(server, timeout: int = 5) -> None:
    """server(Popen)와 그 자식들을 OS별 방식으로 확실히 종료한다.

    1) Windows: taskkill /F /T — 프로세스 트리째 강제 종료
    2) POSIX: killpg(SIGTERM) — SPAWN_KW로 띄웠으면 pgid==pid라 트리째 신호가 간다.
       (그룹 신호가 불가하면 terminate 폴백)
    3) timeout 내 안 죽으면 SIGKILL/kill()로 마무리 — 좀비·포트 점유 방지
    """
    if server is None:
        return
    if os.name == "nt":
        subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(server.pid, signal.SIGTERM)
        except Exception:
            try:
                server.terminate()
            except Exception:
                pass
    try:
        server.wait(timeout=timeout)
    except Exception:
        try:
            if os.name != "nt":
                os.killpg(server.pid, signal.SIGKILL)
            else:
                server.kill()
        except Exception:
            try:
                server.kill()
            except Exception:
                pass
