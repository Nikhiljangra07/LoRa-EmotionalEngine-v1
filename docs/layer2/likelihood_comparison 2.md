# Writer vs Reader Likelihood Comparison

- Writer table: `envent_writer_v1`
- Reader table: `envent_reader_v1`
- Generated: 2026-02-19T13:27:02.895Z

## Max Divergence per Dimension (Jensen-Shannon)

| Dimension | Max JSD | Emotion at Max | Mean JSD | Flags (JSD>0.15) |
|---|---:|---|---:|---:|
| valence | 0.0463 | no-emotion | 0.0077 | 0 |
| agency | 0.0420 | joy | 0.0147 | 0 |
| control | 0.0384 | trust | 0.0109 | 0 |
| arousal | 0.0329 | surprise | 0.0136 | 0 |
| goalRelevance | 0.0256 | surprise | 0.0121 | 0 |
| certainty | 0.0170 | disgust | 0.0050 | 0 |

## Top 5 Writer vs Reader Probability Shifts

| Dimension | Emotion | Bin | Writer | Reader | |Δ| |
|---|---|---|---:|---:|---:|
| control | trust | MED | 0.4459 | 0.6699 | 0.2240 |
| valence | no-emotion | NEG | 0.1985 | 0.4175 | 0.2190 |
| arousal | surprise | MED | 0.4613 | 0.6699 | 0.2086 |
| arousal | surprise | HIGH | 0.4768 | 0.2816 | 0.1953 |
| valence | no-emotion | NEU | 0.4948 | 0.3010 | 0.1939 |

## Numeric Summary

- Stable dimensions (max JSD < 0.05): valence, agency, control, arousal, goalRelevance, certainty
- Observer-sensitive dimensions (max JSD ≥ 0.05): none
- FEAR/control dominant bin: writer=LOW, reader=LOW
- ANGER/agency dominant bin: writer=OTHER, reader=OTHER
- FEAR/control consistency: consistent
- ANGER/agency consistency: consistent
