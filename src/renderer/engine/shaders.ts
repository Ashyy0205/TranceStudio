// Shaders ported from trance's shaders.h (GLSL 1.10) to GLSL ES 3.00.
// The maths is unchanged; only syntax was adapted (float literals, in/out).

export const IMAGE_VERTEX = `#version 300 es
precision highp float;
// Distance to near plane. Controls the field of view.
uniform float near_plane;
// Distance to far plane. Controls the effect of zoom.
uniform float far_plane;
// Unitless eye offset relative to near plane.
uniform float eye_offset;
uniform vec4 colour;

// Virtual position: XY in screen-fit units, Z = zoom amount, W = zoom origin.
in vec4 virtual_position;
in vec2 texture_coord;

out vec2 out_texture_coord;
out vec4 out_colour;

void main()
{
  mat4 m_perspective = mat4(
      near_plane, 0., 0., 0.,
      0., near_plane, 0., 0.,
      0., 0., (near_plane + far_plane) / (near_plane - far_plane), -1.,
      0., 0., 2. * (near_plane * far_plane) / (near_plane - far_plane), 0.);

  float s = (1. - virtual_position.w) * far_plane / near_plane + virtual_position.w;
  mat4 m_virtual = mat4(
      s, 0., 0., 0.,
      0., s, 0., 0.,
      0., 0., far_plane - near_plane, 0.,
      -eye_offset, 0., -far_plane, 1.);

  gl_Position = m_perspective * m_virtual * vec4(virtual_position.xyz, 1.);
  out_texture_coord = texture_coord;
  out_colour = colour;
}
`;

export const IMAGE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tex;
in vec2 out_texture_coord;
in vec4 out_colour;
out vec4 frag_colour;

void main()
{
  frag_colour = out_colour * texture(tex, out_texture_coord);
}
`;

// Converts the rendered frame to planar YUV 4:2:0 (I420, BT.709 limited range)
// for video export, flipping it the right way up. Output bytes are packed four
// per RGBA texel so the readback works everywhere; reading the target back
// row by row yields the I420 byte stream ffmpeg expects. Ported in spirit from
// trance's yuv_fragment, which also converted on the GPU before encoding.
export const YUV_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform int W;
uniform int H;
out vec4 frag_colour;

vec3 px(int x, int y) {
  // Image row y (top = 0) lives at texture row H - 1 - y.
  return texelFetch(src, ivec2(x, H - 1 - y), 0).rgb;
}

float luma(int i) {
  vec3 c = px(i % W, i / W);
  return 16.0 / 255.0 + dot(c, vec3(0.1826, 0.6142, 0.0620));
}

vec3 chroma2x2(int cx, int cy) {
  return 0.25 * (px(2 * cx, 2 * cy) + px(2 * cx + 1, 2 * cy) + px(2 * cx, 2 * cy + 1) + px(2 * cx + 1, 2 * cy + 1));
}

float byteAt(int i) {
  int ySize = W * H;
  int cw = W / 2;
  int cSize = ySize / 4;
  if (i < ySize) return luma(i);
  i -= ySize;
  if (i < cSize) {
    vec3 c = chroma2x2(i % cw, i / cw);
    return 128.0 / 255.0 + dot(c, vec3(-0.1006, -0.3386, 0.4392));
  }
  i -= cSize;
  vec3 c = chroma2x2(i % cw, i / cw);
  return 128.0 / 255.0 + dot(c, vec3(0.4392, -0.3989, -0.0403));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int base = (p.y * (W / 4) + p.x) * 4;
  frag_colour = vec4(byteAt(base), byteAt(base + 1), byteAt(base + 2), byteAt(base + 3));
}
`;

export const SPIRAL_VERTEX = `#version 300 es
precision highp float;
in vec2 device_position;
out vec2 out_texture_coord;

void main() {
  gl_Position = vec4(device_position.xy, 0.0, 1.0);
  out_texture_coord = device_position;
}
`;

export const SPIRAL_FRAGMENT = `#version 300 es
precision highp float;
uniform float near_plane;
uniform float far_plane;
uniform float eye_offset;
// Width divided by height.
uniform float aspect_ratio;
// A divisor of 360 (determines the number of spiral arms).
uniform float width;
// Switch between spiral types.
uniform float spiral_type;
// Makes the spiral spin.
uniform float time;
uniform vec4 acolour;
uniform vec4 bcolour;

in vec2 out_texture_coord;
out vec4 frag_colour;

float spiral1(float r) { return log(r); }
float spiral2(float r) { return r * r; }
float spiral3(float r) { return r; }
float spiral4(float r) { return sqrt(r); }
float spiral5(float r) { return -abs(r - 1.); }
float spiral6(float r)
{
  float r1 = r * 1.2;
  float r2 = (1.5 - 0.5 * r) * 1.2;
  return r < 1. ? pow(r1, 6.0) : -pow(r2, 6.0);
}
float spiral7(float r)
{
  float m = mod(r, 0.2);
  m = m < 0.1 ? m : 0.2 - m;
  return r + m * 3.0;
}

// Raycasts from eye through near plane onto a cone defined by the near and far planes.
vec2 cone_intersection(vec2 aspect_position)
{
  vec3 cone_origin = vec3(0., 0., far_plane);
  vec3 cone_axis = vec3(0., 0., -1.);
  float max_width = aspect_ratio + abs(eye_offset);
  float cone_angle = atan(
      (sqrt(max_width * max_width + 1.)) / (far_plane - near_plane));

  vec3 ray_origin = vec3(eye_offset, 0., 0.);
  vec3 ray_vector = normalize(vec3(aspect_position, near_plane));

  vec3 m = cone_axis * cone_axis - cos(cone_angle) * cos(cone_angle);
  vec3 delta = ray_origin - cone_origin;

  float a = dot(m, ray_vector * ray_vector);
  float b = 2. * dot(m, ray_vector * delta);
  float c = dot(m, delta * delta);

  float d = sqrt(b * b - 4. * a * c);
  float t0 = (-b - d) / (2. * a);
  float t1 = (-b + d) / (2. * a);
  float d0 = dot(cone_axis, ray_origin + t0 * ray_vector - cone_origin);
  float d1 = dot(cone_axis, ray_origin + t1 * ray_vector - cone_origin);

  float t = 0.;
  if (a == 0.) {
    t = -c / b;
  } else if (d == 0.) {
    t = -b / (2. * a);
  }
  // Note: not an else-if in the original either; this always decides.
  if (t0 < 0. || d0 < 0.) {
    t = t1;
  } else {
    t = t0;
  }

  vec3 cone_intersection = ray_origin + t * ray_vector;
  return near_plane * cone_intersection.xy / cone_intersection.z;
}

void main(void)
{
  vec2 position = cone_intersection(out_texture_coord * vec2(aspect_ratio, 1.));
  float angle = 0.;
  float radius = length(position);

  if (position.x != 0. && position.y != 0.) {
    angle = degrees(atan(position.y, position.x));
  }

  float factor =
      spiral_type == 1. ? spiral1(radius) :
      spiral_type == 2. ? spiral2(radius) :
      spiral_type == 3. ? spiral3(radius) :
      spiral_type == 4. ? spiral4(radius) :
      spiral_type == 5. ? spiral5(radius) :
      spiral_type == 6. ? spiral6(radius) :
                          spiral7(radius);
  float amod = mod(angle - width * time - 2. * width * factor, width);
  float v = amod < width / 2. ? 0. : 1.;
  float t = .2 + 2. * (1.0 - pow(min(1., radius), .4));
  if (amod > width / 2.0 - t && amod < width / 2. + t) {
    v = (amod - width / 2. + t) / (2. * t);
  }
  if (amod < t) {
    v = 1. - (amod + t) / (2. * t);
  }
  if (amod > width - t) {
    v = 1. - (amod - width + t) / (2. * t);
  }
  frag_colour = mix(
      (acolour + bcolour) / 2.,
      mix(acolour, bcolour, v),
      clamp(radius * 1024. / (360. / width), 0., 1.));
}
`;
