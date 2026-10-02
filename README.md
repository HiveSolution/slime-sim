# slime-sim

An interactive slime mould simulation that runs in the browser on WebGPU.
Thousands of simple agents follow and reinforce each other's trails, and
transport networks emerge on their own. Every parameter of the model can be
changed while it runs.

The model is the one described in:

> Jeff Jones, "Characteristics of Pattern Formation and Evolution in
> Approximations of Physarum Transport Networks", _Artificial Life_ 16(2),
> 127–153, 2010.

## Requirements

- Node.js 24 (LTS)
- A browser with WebGPU: current Chrome, Edge, Firefox or Safari

## Commands

```powershell
npm install
npm start                    # dev server on http://localhost:4200
npx ng test --watch=false    # unit tests
npx ng build                 # production build in dist/slime-sim
```

## How it works

Each agent has a position, a heading and three sensors ahead of it (left,
front, right). One step of the simulation is:

1. **Sense and rotate.** The agent reads the trail at its three sensors and
   turns towards the strongest one.
2. **Move.** It tries to step forward. A cell holds only one agent, so the
   move fails if the target cell is taken; the agent then stays where it is
   and picks a random new heading.
3. **Deposit.** Every agent that moved adds to the trail on its new cell.
4. **Diffuse and decay.** The trail map is blurred with a 3×3 mean filter
   and multiplied by `1 - decay`.

The grid wraps around at the edges.

On the GPU a step is three passes:

| Pass    | Kind    | What it does                                                    |
| ------- | ------- | --------------------------------------------------------------- |
| Agents  | Compute | Steps 1 and 2 for every agent in parallel                       |
| Diffuse | Render  | Step 4, from one trail texture into the other                   |
| Deposit | Render  | Step 3: draws agents as additive points onto the diffused trail |

A fourth pass colours the trail map onto the canvas.

### Where it differs from the paper

- The paper moves agents one at a time in random order. Here they all move
  at once, and two agents that want the same cell race for it with an atomic
  compare-and-exchange. Exactly one wins, but which one is up to the GPU.
- "Agents per cell: Unlimited" turns the one-agent-per-cell rule off. That is
  not in the paper; agents then pile up and the network collapses into a few
  thick strands.
- **Species** are not in the paper. There can be up to four, each with its own
  settings, colour and trail (one channel of the trail map each). The agents
  are dealt out equally between them. An agent is attracted to its own
  species' trail and repelled by the others: what a sensor reads is its own
  trail minus `avoidance` times the sum of the other trails. All species
  share the grid, so with one agent per cell they also block each other.
- The trail map uses 16-bit floats.

## Controls

| Control            | Paper name | Meaning                                                    |
| ------------------ | ---------- | ---------------------------------------------------------- |
| Sensor angle       | SA         | Angle of the left and right sensors from the front one     |
| Rotation angle     | RA         | How far an agent turns per step                            |
| Sensor offset      | SO         | Distance from the agent to its sensors; sets pattern scale |
| Step size          | SS         | Distance moved per step                                    |
| Random turn chance | pCD        | Probability per step of a random new heading               |
| Deposit            | depT       | Trail added per successful move                            |
| Decay              | decayT     | Share of the trail lost per step                           |
| Population         | %p         | Agents as a percentage of the grid's cells                 |
| Agents per cell    |            | One (paper) or unlimited                                   |
| Grid height        |            | Grid resolution; the width follows the window's shape      |
| Start shape        |            | Random (paper), a disc, or a ring facing inwards           |
| Steps per frame    |            | Simulation speed                                           |
| Brightness         |            | Display only                                               |

Sensor angle to Deposit are set per species; pick the species with the
numbered buttons. With more than one species there is also **Avoid other
species**, the `avoidance` factor described above.

The presets reproduce figures from the paper. They apply to every species
and keep the species' colours.

## Structure

| Path        | What                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `src/sim/`  | The simulation: settings, start states, WGSL shaders, WebGPU driver. No framework code. |
| `src/app/`  | The Angular app: canvas host and control panel                                          |
| `libs/ui/*` | Spartan UI components (owned copies, editable)                                          |

## Acknowledgements

The idea of putting this model on the GPU with live controls comes from
Sebastian Lague's [Slime-Simulation](https://github.com/SebLague/Slime-Simulation)
for Unity. No code from that project is used here; the shaders are written
from the paper.

## License

[MIT](LICENSE)
