import math
import os
import bpy
import mathutils

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
OUT_DIR = os.path.join(PROJECT_DIR, "public", "assets")
os.makedirs(OUT_DIR, exist_ok=True)


def export_packed_textures():
    mapping = {
        "day.webp": "earth_day.webp",
        "night.webp": "earth_night.webp",
    }
    for src_name, dst_name in mapping.items():
        img = bpy.data.images.get(src_name)
        if not img or not img.packed_file:
            raise RuntimeError(f"Missing packed image '{src_name}' in .blend")
        dst_path = os.path.join(OUT_DIR, dst_name)
        with open(dst_path, "wb") as f:
            f.write(img.packed_file.data)
        print(f"[EXPORT] Extracted {src_name} -> {dst_path} ({len(img.packed_file.data)} bytes)")


def top_subassembly_of(obj, root):
    cur = obj
    while cur and cur.parent and cur.parent != root:
        cur = cur.parent
    return cur.name if cur and cur.parent == root else "HullMisc"


def collect_ship_meshes(root):
    result = []

    def walk(obj):
        if obj.type == "MESH" and "Exhaust" not in obj.name:
            result.append(obj)
        for ch in obj.children:
            walk(ch)

    walk(root)
    return result


def clean_pbr_materials(ship_meshes):
    seen = set()
    for obj in ship_meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or mat.name in seen:
                continue
            seen.add(mat.name)
            nt = mat.node_tree
            if not nt:
                continue
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf:
                continue
            for input_name in ("Roughness", "Normal"):
                if input_name in bsdf.inputs:
                    inp = bsdf.inputs[input_name]
                    for link in list(inp.links):
                        nt.links.remove(link)
            bc = [round(c, 4) for c in bsdf.inputs["Base Color"].default_value[:]]
            met = round(bsdf.inputs["Metallic"].default_value, 3)
            rgh = round(bsdf.inputs["Roughness"].default_value, 3)
            em_str = (
                round(bsdf.inputs["Emission Strength"].default_value, 3)
                if "Emission Strength" in bsdf.inputs
                else 0.0
            )
            print(f"[MAT] {mat.name:28s} base={bc} met={met} rough={rgh} emStr={em_str}")


def build_clean_export_objects(ship_meshes, root):
    export_col = bpy.data.collections.new("NaturalSelectionExport")
    bpy.context.scene.collection.children.link(export_col)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    # Rotate +90 deg around Blender Z and scale 0.1 so:
    # Blender (+X prow, +Y port, +Z up) -> glTF/Three.js (+X starboard/-Y_b, +Y up/+Z_b, -Z prow/+X_b)
    bake_xform = mathutils.Matrix.Scale(0.1, 4) @ mathutils.Matrix.Rotation(math.pi / 2.0, 4, "Z")

    groups = {}
    for src_obj in ship_meshes:
        eval_obj = src_obj.evaluated_get(depsgraph)
        mesh_data = bpy.data.meshes.new_from_object(
            eval_obj, preserve_all_data_layers=True, depsgraph=depsgraph
        )
        world_xform = bake_xform @ src_obj.matrix_world
        mesh_data.transform(world_xform)
        if world_xform.determinant() < 0:
            mesh_data.flip_normals()
        mesh_data.update()

        sub_name = top_subassembly_of(src_obj, root)
        mat_key = "_".join(m.name for m in mesh_data.materials if m) or "NoMaterial"
        group_key = (sub_name, mat_key)

        new_obj = bpy.data.objects.new(f"{sub_name}__{mat_key}", mesh_data)
        export_col.objects.link(new_obj)
        groups.setdefault(group_key, []).append(new_obj)

    bpy.ops.object.select_all(action="DESELECT")
    merged_objects = []
    for (sub_name, mat_key), objs in sorted(groups.items()):
        if len(objs) == 1:
            merged_objects.append(objs[0])
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        safe_mat = mat_key.replace(" ", "_").replace("|", "")
        joined.name = f"{sub_name}__{safe_mat}"
        merged_objects.append(joined)

    # Generate clean triplanar box-projected UVs in ship space so normal/roughness detail maps tile evenly
    uv_scale = 0.75
    for obj in merged_objects:
        mesh = obj.data
        uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
        uv_data = uv_layer.data
        verts = mesh.vertices
        for poly in mesh.polygons:
            n = poly.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop_idx in poly.loop_indices:
                co = verts[mesh.loops[loop_idx].vertex_index].co
                if az >= ax and az >= ay:
                    uv_data[loop_idx].uv = (co.x * uv_scale, co.y * uv_scale)
                elif ay >= ax and ay >= az:
                    uv_data[loop_idx].uv = (co.x * uv_scale, co.z * uv_scale)
                else:
                    uv_data[loop_idx].uv = (co.y * uv_scale, co.z * uv_scale)

    return merged_objects


def verify_three_bounds(merged_objects):
    # Blender (x, y, z) -> Three.js Y-up (x, z, -y)
    tx, ty, tz = [], [], []
    total_polys = 0
    total_verts = 0
    for o in merged_objects:
        total_polys += len(o.data.polygons)
        total_verts += len(o.data.vertices)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            tx.append(w.x)
            ty.append(w.z)
            tz.append(-w.y)
    print(
        f"[VERIFY] Batched into {len(merged_objects)} meshes, "
        f"{total_verts} verts, {total_polys} polys"
    )
    print(
        f"[VERIFY] Three.js space BBox: "
        f"X=[{min(tx):.3f}, {max(tx):.3f}] (width={max(tx)-min(tx):.3f}), "
        f"Y=[{min(ty):.3f}, {max(ty):.3f}] (height={max(ty)-min(ty):.3f}), "
        f"Z=[{min(tz):.3f}, {max(tz):.3f}] (length={max(tz)-min(tz):.3f})"
    )


def main():
    export_packed_textures()

    root = bpy.data.objects.get("NaturalSelectionRoot")
    if not root:
        raise RuntimeError("NaturalSelectionRoot not found in .blend")

    ship_meshes = collect_ship_meshes(root)
    print(f"[EXPORT] Found {len(ship_meshes)} ship meshes under NaturalSelectionRoot")
    clean_pbr_materials(ship_meshes)

    merged_objects = build_clean_export_objects(ship_meshes, root)
    verify_three_bounds(merged_objects)

    bpy.ops.object.select_all(action="DESELECT")
    for o in merged_objects:
        o.select_set(True)

    glb_path = os.path.join(OUT_DIR, "natural_selection.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=12,
        export_draco_texcoord_quantization=12,
    )
    size_bytes = os.path.getsize(glb_path)
    print(f"[EXPORT] Wrote GLB: {glb_path} ({size_bytes / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    main()
