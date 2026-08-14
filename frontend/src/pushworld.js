// JavaScript port of the official PushWorld simulator from index.js

export const colors = {
  SELF: "#00DC00",
  SELF_BORDER: "#006E00",
  SELF_WALL: "#FAC71E",
  SELF_WALL_BORDER: "#7D640F",
  GOAL: null,
  GOAL_BORDER: "#B90000",
  GOAL_OBJECT: "#DC0000",
  GOAL_OBJECT_BORDER: "#6E0000",
  MOVEABLE: "#469BFF",
  MOVEABLE_BORDER: "#23487F",
  WALL: "#0A0A0A",
  WALL_BORDER: "#050505",
};

export function convertFileToPushworld(name, filedump) {
  const lines = filedump.split("\n").map(line => line.trim()).filter(line => line);
  const elements = { 'w': [] };
  let r = 1;
  let max_c = 0;
  for (const line of lines) {
    const cells = line.split(" ").filter(c => c);
    max_c = Math.max(max_c, cells.length);
    for (let c = 1; c <= cells.length; c++) {
      const cell = cells[c - 1].split("+").filter(e => e);
      for (let k = 0; k < cell.length; k++) {
        const e = cell[k].toLowerCase();
        if (e !== ".") {
          if (!(e in elements)) elements[e] = [];
          elements[e].push([r, c]);
        }
      }
    }
    r += 1;
  }
  const c = max_c;
  const grid_dimensions = [r + 1, c + 1];

  // Append the border wall pixels
  for (let rr = 0; rr <= r; rr++) {
    elements['w'].push([rr, 0]);
    elements['w'].push([rr, c + 1]);
  }
  for (let cc = 1; cc <= c; cc++) {
    elements['w'].push([0, cc]);
    elements['w'].push([r, cc]);
  }

  const pushworld = {
    name: name,
    moveables: [],
    goals: [],
    walls: [],
    grid_dimensions: grid_dimensions
  };

  const sorted_elements = Object.keys(elements);
  sorted_elements.sort();

  for (const e of sorted_elements) {
    let pixels = elements[e];
    const position = get2DMin(pixels);
    pixels = pixels.map(p => subPoints(p, position));

    const [edgeChains, contractionDirections, boundaryPixels] = extractEdgePolygons(pixels);

    const obj = {
      id: e,
      position: position,
      edgeChains: edgeChains,
      contractionDirections: contractionDirections,
      fillPixels: pixels,
      boundaryPixels: boundaryPixels,
    };

    if (e === 'a') {
      pushworld.moveables.push(obj);
      obj.fillColor = colors.SELF;
      obj.borderColor = colors.SELF_BORDER;
    } else if (e[0] === 'm') {
      pushworld.moveables.push(obj);
      const goal_name = e.replace('m', 'g');
      if (goal_name in elements) {
        obj.goal_position = get2DMin(elements[goal_name]);
        obj.fillColor = colors.GOAL_OBJECT;
        obj.borderColor = colors.GOAL_OBJECT_BORDER;
      } else {
        obj.fillColor = colors.MOVEABLE;
        obj.borderColor = colors.MOVEABLE_BORDER;
      }
    } else if (e[0] === 'g') {
      pushworld.goals.push(obj);
      obj.fillColor = colors.GOAL;
      obj.borderColor = colors.GOAL_BORDER;
    } else if (e === 'w') {
      pushworld.walls.push(obj);
      obj.fillColor = colors.WALL;
      obj.borderColor = colors.WALL_BORDER;
    } else if (e === 'aw') {
      pushworld.walls.push(obj);
      obj.fillColor = colors.SELF_WALL;
      obj.borderColor = colors.SELF_WALL_BORDER;
    }
  }

  pushworld.initial_state = pushworld.moveables.map(m => m.position);
  return pushworld;
}

function extractEdgePolygons(pixels) {
  const edges = [];
  const dirs = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0]
  ];
  const clock_rot90 = { 0: 1, 1: 2, 2: 3, 3: 0 };
  const counterclock_rot90 = { 3: 2, 2: 1, 1: 0, 0: 3 };

  for (let p1 of pixels) {
    for (let delta_idx = 0; delta_idx < 4; delta_idx++) {
      const p2 = addPoints(p1, dirs[delta_idx]);
      const edge = [p1, p2, clock_rot90[delta_idx]];

      const duplicate_idx = getEdgeIndex(edge, edges, true);
      if (duplicate_idx === -1) {
        edges.push(edge);
      } else {
        edges.splice(duplicate_idx, 1);
      }
      p1 = p2;
    }
  }

  const edgeChains = [];
  const contractionDirections = [];

  while (edges.length > 0) {
    const chain = [];
    let edge = edges.pop();
    let [p1, p2, cd] = edge;
    chain.push([p1, dirs[cd]]);

    while (true) {
      let idx = -1;
      for (let k = 0; k < 3 && idx === -1; k++) {
        idx = getEdgeIndex([p2, addPoints(p2, dirs[cd]), null], edges);
        cd = counterclock_rot90[cd];
      }
      if (idx !== -1) {
        [p1, p2, cd] = edge = edges.splice(idx, 1)[0];
        chain.push([p1, dirs[cd]]);
      } else {
        break;
      }
    }

    const points = [];
    const contractDirs = [];
    edgeChains.push(points);
    contractionDirections.push(contractDirs);

    for (let k = 0; k < chain.length; k++) {
      points.push(chain[k][0]);
      const prev_k = mod((k - 1), chain.length);
      contractDirs.push(
        clipVector(addPoints(chain[k][1], chain[prev_k][1]), -1, 1)
      );
    }
  }

  const boundaryPixels = pixels;
  return [edgeChains, contractionDirections, boundaryPixels];
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function clipVector(vec, min, max) {
  return vec.map(e => Math.min(Math.max(min, e), max));
}

function getEdgeIndex(edge, edges, reverse) {
  let tp1, tp2;
  if (reverse === undefined || reverse === false) {
    [tp1, tp2] = edge;
  } else {
    [tp2, tp1] = edge;
  }
  for (let i = 0; i < edges.length; i++) {
    const [p1, p2] = edges[i];
    if (p1[0] === tp1[0] && p1[1] === tp1[1] && p2[0] === tp2[0] && p2[1] === tp2[1]) {
      return i;
    }
  }
  return -1;
}

function get2DMin(pixels) {
  if (pixels.length === 1) return pixels[0];
  const min_x = pixels.reduce((a, b) => ((a[0] < b[0]) ? a : b))[0];
  const min_y = pixels.reduce((a, b) => ((a[1] < b[1]) ? a : b))[1];
  return [min_x, min_y];
}

function addPoints(p1, p2) {
  return [p1[0] + p2[0], p1[1] + p2[1]];
}

function subPoints(p1, p2) {
  return [p1[0] - p2[0], p1[1] - p2[1]];
}

function is2DPointInArray(p, array) {
  for (const o of array) {
    if (o[0] === p[0] && o[1] === p[1]) return true;
  }
  return false;
}

export function move(pushworld, state, displacement) {
  let next_state;
  const [pushed_object_ids, transitive_stopping] = getPushedObjects(pushworld, state, displacement);

  if (transitive_stopping) {
    next_state = state;
  } else {
    next_state = [];
    for (let i = 0; i < state.length; i++) {
      const obj = pushworld.moveables[i];
      const pos = state[i];
      if (pushed_object_ids.includes(obj.id)) {
        next_state.push(addPoints(displacement, pos));
      } else {
        next_state.push(pos);
      }
    }
  }
  return [next_state, transitive_stopping];
}

export function isGoalState(pushworld, state) {
  let is_solved = true;
  for (let i = 0; i < state.length; i++) {
    const obj = pushworld.moveables[i];
    const pos = state[i];
    if ('goal_position' in obj) {
      if (obj.goal_position[0] !== pos[0] || obj.goal_position[1] !== pos[1]) {
        is_solved = false;
        break;
      }
    }
  }
  return is_solved;
}

function getObjectIDsToPositions(pushworld, state) {
  const id_to_pos = {};
  for (const w of pushworld.walls) id_to_pos[w.id] = w.position;
  for (const g of pushworld.goals) id_to_pos[g.id] = g.position;
  for (let i = 0; i < state.length; i++) id_to_pos[pushworld.moveables[i].id] = state[i];
  return id_to_pos;
}

function getPushedObjects(pushworld, state, displacement) {
  const actor = pushworld.moveables[0];
  const frontier = [actor];
  let transitive_stopping = false;
  const pushed_object_ids = [];

  const tangible_objects = [].concat(pushworld.moveables, pushworld.walls);
  const id_to_pos = getObjectIDsToPositions(pushworld, state);

  while (frontier.length > 0 && !transitive_stopping) {
    const obj = frontier.pop();
    if (pushed_object_ids.includes(obj.id)) continue;

    pushed_object_ids.push(obj.id);

    for (const other_obj of tangible_objects) {
      if (pushed_object_ids.includes(other_obj.id)) continue;
      if (obj.id !== 'a' && other_obj.id === 'aw') continue;

      const new_pos = addPoints(id_to_pos[obj.id], displacement);
      const rel_pos = subPoints(new_pos, id_to_pos[other_obj.id]);

      for (const obj_px of obj.boundaryPixels) {
        const rel_obj_px = addPoints(obj_px, rel_pos);
        if (is2DPointInArray(rel_obj_px, other_obj.boundaryPixels)) {
          frontier.push(other_obj);
          if (other_obj.id === 'w') {
            transitive_stopping = true;
          } else if (obj.id === 'a' && other_obj.id === 'aw') {
            transitive_stopping = true;
          }
          break;
        }
      }
    }
  }
  return [pushed_object_ids, transitive_stopping];
}

// Canvas Drawing functions
export function drawCanvas(ctx, pushworld, state, show_grid = true) {
  const canvas = ctx.canvas;
  const containerWidth = canvas.parentNode ? canvas.parentNode.clientWidth : 500;
  const size = Math.min(containerWidth, 500);
  canvas.width = size;
  canvas.height = size;
  
  const grid_dimensions = pushworld.grid_dimensions;
  const scale = Math.min(size / grid_dimensions[0], size / grid_dimensions[1]);
  const center_offset = [
    (size - scale * grid_dimensions[0]) / 2,
    (size - scale * grid_dimensions[1]) / 2,
  ];

  ctx.clearRect(0, 0, size, size);

  if (show_grid) {
    ctx.strokeStyle = "#2e2a47";
    ctx.lineWidth = 1;
    for (let i = 0; i <= grid_dimensions[0]; i++) {
      ctx.beginPath();
      ctx.moveTo(center_offset[1], i * scale + center_offset[0]);
      ctx.lineTo(grid_dimensions[1] * scale + center_offset[1], i * scale + center_offset[0]);
      ctx.stroke();
    }
    for (let j = 0; j <= grid_dimensions[1]; j++) {
      ctx.beginPath();
      ctx.moveTo(j * scale + center_offset[1], center_offset[0]);
      ctx.lineTo(j * scale + center_offset[1], grid_dimensions[0] * scale + center_offset[0]);
      ctx.stroke();
    }
  }

  // Draw walls, moveables, goals
  const objects = [].concat(
    pushworld.walls.map(w => [w, w.position]),
    state.map((pos, idx) => [pushworld.moveables[idx], pos]),
    pushworld.goals.map(g => [g, g.position])
  );

  const border_width = 2;

  for (const [obj, pos] of objects) {
    if (!obj.fillColor && obj.id[0] === 'g') {
      // Goal background (transparent/none, draw outline only)
    } else {
      ctx.fillStyle = obj.fillColor;
      for (const [x, y] of obj.fillPixels) {
        const abs_x = Math.round((x + pos[0]) * scale + center_offset[0]);
        const abs_y = Math.round((y + pos[1]) * scale + center_offset[1]);
        const abs_x2 = Math.round((x + 1 + pos[0]) * scale + center_offset[0]);
        const abs_y2 = Math.round((y + 1 + pos[1]) * scale + center_offset[1]);
        ctx.fillRect(abs_y, abs_x, abs_y2 - abs_y, abs_x2 - abs_x);
      }
    }

    // Draw borders/outlines
    for (let k = 0; k < obj.edgeChains.length; k++) {
      const points = obj.edgeChains[k];
      const contraction = obj.contractionDirections[k];
      if (points.length < 2) continue;

      ctx.beginPath();
      const first_p = points[0];
      const first_c = contraction[0];
      ctx.moveTo(
        (first_p[1] + pos[1]) * scale + center_offset[1] + (border_width / 2) * first_c[1],
        (first_p[0] + pos[0]) * scale + center_offset[0] + (border_width / 2) * first_c[0]
      );

      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        const c = contraction[i];
        ctx.lineTo(
          (p[1] + pos[1]) * scale + center_offset[1] + (border_width / 2) * c[1],
          (p[0] + pos[0]) * scale + center_offset[0] + (border_width / 2) * c[0]
        );
      }
      ctx.closePath();
      ctx.strokeStyle = obj.borderColor;
      ctx.lineWidth = border_width;
      ctx.stroke();
    }
  }
}
