# Dashboard Design System

Notion/Tally 스타일의 미니멀 디자인 시스템. 모든 UI 작업 시 이 규칙을 따를 것.

## Typography

- **Font**: Pretendard Variable (CDN, `index.css`에서 로드)
- **Scale**: `xs`(10px) / `sm`(12px) / `base`(14px) / `lg`(16px) / `xl`(18px) / `2xl`(24px) / `3xl`(30px)
- 기본 본문: `text-base` (14px)
- 라벨/캡션: `text-xs` (10px)
- 테이블 셀: `text-sm` (12px)

## Color Tokens

### Text (Ink)
| Token | Hex | Usage |
|-------|-----|-------|
| `text-ink` | #111111 | 기본 텍스트, 제목 |
| `text-ink-secondary` | #505050 | 보조 텍스트, 테이블 셀 |
| `text-ink-tertiary` | #767676 | 라벨, 비활성 텍스트 |

### Background (Surface)
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-surface` | #FFFFFF | 카드, 모달, 헤더 |
| `bg-surface-page` | #F7F7FB | 페이지 배경 |
| `bg-surface-panel` | #F1F1F5 | 패널, 코드블록, hover |

### Border (Line)
| Token | Hex | Usage |
|-------|-----|-------|
| `border-line-light` | #F0F0F6 | 테이블 행 구분 |
| `border-line` | #E5E5EC | 카드/섹션 테두리 |
| `border-line-heavy` | #111111 | 강조 구분선 (사용 빈도 낮음) |

### Brand
| Token | Hex | Usage |
|-------|-----|-------|
| `text-brand` / `bg-brand` | #3366FF | 주요 액션, 링크, 활성 상태 |
| `bg-brand-light` | #EBF0FF | 수신 배지 배경 등 |

### Semantic Status
| Token | Hex | Usage |
|-------|-----|-------|
| `text-positive` / `bg-positive` | #065F46 | 긍정, 완료, 온라인 |
| `bg-positive-bg` | #ECFDF5 | 긍정 배경 |
| `text-negative` / `bg-negative` | #991B1B | 부정, 실패 |
| `bg-negative-bg` | #FEF2F2 | 부정 배경 |
| `text-caution` / `bg-caution` | #92400E | 경고, 통화중 |
| `bg-caution-bg` | #FFFBEB | 경고 배경 |

## Border Radius

- `rounded-sm`: 4px
- `rounded` / `rounded-md`: 6px (기본)
- `rounded-lg` / `rounded-xl`: 8px (카드, 모달)
- `rounded-full`: 9999px (원형 버튼, 도트)

## Shadows

- `shadow-sm`: `0 1px 2px rgba(0,0,0,0.04)` — 미니멀 카드
- `shadow`: `0 1px 3px rgba(0,0,0,0.06)` — 기본
- `shadow-md`: `0 2px 8px rgba(0,0,0,0.08)` — 드롭다운
- `shadow-modal`: `0 8px 30px rgba(0,0,0,0.12)` — 모달

## UI 규칙

### 레이아웃
- 페이지 배경: `bg-surface-page`
- 카드/섹션: `bg-surface border border-line rounded-lg`
- 간격: Tailwind spacing (`gap-3`, `px-6 py-5`, `space-y-5`)

### 테이블
- 헤더: `text-xs font-medium text-ink-tertiary` (대문자 변환 없음)
- 행 구분: `border-b border-line-light` (수평선만, 세로선 없음)
- hover: `hover:bg-surface-panel`
- 클릭 가능 행: `cursor-pointer transition-colors`

### 배지
- 도트 + 텍스트 스타일 사용 (무거운 컬러 배경 금지)
- 예: `<span className="w-1.5 h-1.5 rounded-full bg-positive" />` + `text-positive`

### 모달
- 오버레이: `bg-ink/40`
- 컨테이너: `bg-surface rounded-lg shadow-modal max-w-[680px]`
- 헤더/본문 구분: `border-b border-line`

### 버튼
- Primary: `bg-brand text-white rounded hover:opacity-90`
- Ghost: `hover:bg-surface-panel text-ink-tertiary hover:text-ink rounded`
- 둥근 아이콘 버튼: `w-8 h-8 rounded-full bg-ink flex items-center justify-center`

### 상태 표시
- 온라인/완료: `bg-positive` 도트 (7px)
- 오프라인/실패: `bg-negative` 도트
- 처리중: `bg-brand animate-pulse` 도트
- 연결 상태: `w-[6px] h-[6px] rounded-full`

## 금지 사항

- Tailwind 기본 색상 (`slate-*`, `gray-*`, `emerald-*`, `rose-*` 등) 직접 사용 금지
- 무거운 그림자 (`shadow-lg`, `shadow-xl`) 금지
- 큰 border-radius (`rounded-2xl`, `rounded-3xl`) 금지
- 컬러풀한 배지 배경 금지 (도트+텍스트 패턴 사용)
- 대문자 변환 (`uppercase`) 금지
