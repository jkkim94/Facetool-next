// pybind11 wrapper around Epic's standalone RigLogic / DNA library (rl4).
// Exposes DNA 2.5 reading (geometry + definition) and RigLogic evaluation
// (GUI controls -> blendshape weights + joint transforms) to Python.

#include <pybind11/pybind11.h>
#include <pybind11/numpy.h>
#include <pybind11/stl.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "dna/BinaryStreamReader.h"
#include "dna/types/Aliases.h"

#include "riglogic/RigLogic.h"
#include "riglogic/riglogic/Configuration.h"
#include "pma/resources/AlignedMemoryResource.h"

namespace py = pybind11;

namespace {

std::string sv_to_string(const dna::StringView& sv) {
    return std::string(sv.data(), sv.size());
}

template <typename T>
py::array_t<T> view_to_array(const av::ConstArrayView<T>& view) {
    // Some optional DNA sections expose invalid views when empty; guard aggressively.
    constexpr std::size_t kMaxViewElems = 64u * 1024u * 1024u;
    if (view.data() == nullptr || view.size() == 0 || view.size() > kMaxViewElems) {
        return py::array_t<T>(0);
    }
    py::array_t<T> out(static_cast<py::ssize_t>(view.size()));
    std::memcpy(out.mutable_data(), view.data(), view.size() * sizeof(T));
    return out;
}

}  // namespace

class Rig {
public:
    explicit Rig(const std::string& dnaPath,
                 bool scalar = true,
                 bool loadJoints = true,
                 bool loadBlendShapes = true,
                 bool loadAnimatedMaps = true,
                 bool loadMachineLearnedBehavior = true,
                 bool loadRBFBehavior = true,
                 bool loadTwistSwingBehavior = true,
                 bool quaternions = true) {
        stream_ = trio::FileStream::create(
            dnaPath.c_str(),
            trio::FileStream::AccessMode::Read,
            trio::FileStream::OpenMode::Binary);
        if (!sc::Status::isOk()) {
            throw std::runtime_error("Failed to open DNA file: " + dnaPath);
        }
        reader_ = dna::BinaryStreamReader::create(stream_, dna::DataLayer::All);
        reader_->read();
        if (!sc::Status::isOk()) {
            auto st = sc::Status::get();
            throw std::runtime_error(std::string("Failed to read DNA: ") + st.message);
        }
        rl4::Configuration config;
        config.calculationType = scalar ? rl4::CalculationType::Scalar : rl4::CalculationType::SSE;
        config.rotationType = quaternions ? rl4::RotationType::Quaternions : rl4::RotationType::EulerAngles;
        // Library is compiled with RL_BUILD_WITH_ZYX_ROTATION_ORDER, so the quaternion
        // joint strategy is only available for ZYX; must match or strategy is null.
        config.rotationOrder = rl4::RotationOrder::ZYX;
        attrsPerJoint_ = quaternions ? 10 : 9;
        config.loadJoints = loadJoints;
        config.loadBlendShapes = loadBlendShapes;
        config.loadAnimatedMaps = loadAnimatedMaps;
        config.loadMachineLearnedBehavior = loadMachineLearnedBehavior;
        config.loadRBFBehavior = loadRBFBehavior;
        config.loadTwistSwingBehavior = loadTwistSwingBehavior;
        rigLogic_ = rl4::RigLogic::create(reader_, config, &memRes_);
        if (rigLogic_ == nullptr) {
            throw std::runtime_error("Failed to create RigLogic from DNA");
        }
        rigInstance_ = rl4::RigInstance::create(rigLogic_, &memRes_);
        if (rigInstance_ == nullptr) {
            throw std::runtime_error("Failed to create RigInstance");
        }
    }

    ~Rig() {
        if (rigInstance_) rl4::RigInstance::destroy(rigInstance_);
        if (rigLogic_) rl4::RigLogic::destroy(rigLogic_);
        if (reader_) dna::BinaryStreamReader::destroy(reader_);
        if (stream_) trio::FileStream::destroy(stream_);
    }

    // ---- Definition ----
    std::uint16_t lodCount() const { return reader_->getLODCount(); }

    std::uint16_t guiControlCount() const { return reader_->getGUIControlCount(); }
    std::uint16_t rawControlCount() const { return reader_->getRawControlCount(); }
    std::uint16_t jointCount() const { return reader_->getJointCount(); }
    std::uint16_t blendShapeChannelCount() const { return reader_->getBlendShapeChannelCount(); }
    std::uint16_t animatedMapCount() const { return reader_->getAnimatedMapCount(); }
    std::uint16_t meshCount() const { return reader_->getMeshCount(); }

    std::vector<std::string> guiControlNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getGUIControlCount(); ++i)
            out.push_back(sv_to_string(reader_->getGUIControlName(i)));
        return out;
    }
    std::vector<std::string> rawControlNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getRawControlCount(); ++i)
            out.push_back(sv_to_string(reader_->getRawControlName(i)));
        return out;
    }
    std::vector<std::string> jointNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getJointCount(); ++i)
            out.push_back(sv_to_string(reader_->getJointName(i)));
        return out;
    }
    std::vector<std::string> blendShapeChannelNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getBlendShapeChannelCount(); ++i)
            out.push_back(sv_to_string(reader_->getBlendShapeChannelName(i)));
        return out;
    }
    std::vector<std::string> animatedMapNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getAnimatedMapCount(); ++i)
            out.push_back(sv_to_string(reader_->getAnimatedMapName(i)));
        return out;
    }
    std::vector<std::string> meshNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getMeshCount(); ++i)
            out.push_back(sv_to_string(reader_->getMeshName(i)));
        return out;
    }

    py::array_t<std::uint16_t> jointParentIndices() const {
        const std::uint16_t n = reader_->getJointCount();
        py::array_t<std::uint16_t> out(n);
        auto* p = out.mutable_data();
        for (std::uint16_t i = 0; i < n; ++i) p[i] = reader_->getJointParentIndex(i);
        return out;
    }

    std::vector<int> meshIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getMeshIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }

    // neutral joint transforms: (J,3)
    py::array_t<float> neutralJointTranslations() const {
        return xyz_(reader_->getNeutralJointTranslationXs(),
                    reader_->getNeutralJointTranslationYs(),
                    reader_->getNeutralJointTranslationZs());
    }
    py::array_t<float> neutralJointRotations() const {
        return xyz_(reader_->getNeutralJointRotationXs(),
                    reader_->getNeutralJointRotationYs(),
                    reader_->getNeutralJointRotationZs());
    }

    // ---- Geometry ----
    py::array_t<float> vertexPositions(std::uint16_t mesh) const {
        return xyz_(reader_->getVertexPositionXs(mesh),
                    reader_->getVertexPositionYs(mesh),
                    reader_->getVertexPositionZs(mesh));
    }
    py::array_t<float> vertexNormals(std::uint16_t mesh) const {
        return xyz_(reader_->getVertexNormalXs(mesh),
                    reader_->getVertexNormalYs(mesh),
                    reader_->getVertexNormalZs(mesh));
    }
    py::array_t<float> vertexUVs(std::uint16_t mesh) const {
        auto us = reader_->getVertexTextureCoordinateUs(mesh);
        auto vs = reader_->getVertexTextureCoordinateVs(mesh);
        const py::ssize_t n = static_cast<py::ssize_t>(us.size());
        py::array_t<float> out({n, (py::ssize_t)2});
        auto* p = out.mutable_data();
        for (py::ssize_t i = 0; i < n; ++i) { p[i*2] = us[i]; p[i*2+1] = vs[i]; }
        return out;
    }
    py::array_t<std::uint32_t> layoutPositionIndices(std::uint16_t mesh) const {
        return view_to_array(reader_->getVertexLayoutPositionIndices(mesh));
    }
    py::array_t<std::uint32_t> layoutUVIndices(std::uint16_t mesh) const {
        return view_to_array(reader_->getVertexLayoutTextureCoordinateIndices(mesh));
    }
    py::array_t<std::uint32_t> layoutNormalIndices(std::uint16_t mesh) const {
        return view_to_array(reader_->getVertexLayoutNormalIndices(mesh));
    }

    // faces -> (counts[F], flatLayoutIndices[sum]) of vertex-layout indices
    py::tuple faces(std::uint16_t mesh) const {
        const std::uint32_t fc = reader_->getFaceCount(mesh);
        std::vector<std::uint32_t> counts; counts.reserve(fc);
        std::vector<std::uint32_t> flat;
        for (std::uint32_t f = 0; f < fc; ++f) {
            auto idx = reader_->getFaceVertexLayoutIndices(mesh, f);
            counts.push_back(static_cast<std::uint32_t>(idx.size()));
            for (auto v : idx) flat.push_back(v);
        }
        py::array_t<std::uint32_t> cArr(counts.size());
        std::memcpy(cArr.mutable_data(), counts.data(), counts.size()*sizeof(std::uint32_t));
        py::array_t<std::uint32_t> fArr(flat.size());
        if (!flat.empty()) std::memcpy(fArr.mutable_data(), flat.data(), flat.size()*sizeof(std::uint32_t));
        return py::make_tuple(cArr, fArr);
    }

    std::uint16_t maxInfluencePerVertex(std::uint16_t mesh) const {
        return reader_->getMaximumInfluencePerVertex(mesh);
    }

    // skin weights padded to maxInfluence: returns (weights[V,M], jointIndices[V,M])
    py::tuple skinWeights(std::uint16_t mesh) const {
        const std::uint32_t vc = reader_->getVertexPositionCount(mesh);
        const std::uint16_t mi = reader_->getMaximumInfluencePerVertex(mesh);
        py::array_t<float> w({(py::ssize_t)vc, (py::ssize_t)mi});
        py::array_t<std::int32_t> ji({(py::ssize_t)vc, (py::ssize_t)mi});
        auto* wp = w.mutable_data();
        auto* jp = ji.mutable_data();
        std::fill(wp, wp + (size_t)vc*mi, 0.0f);
        std::fill(jp, jp + (size_t)vc*mi, 0);
        for (std::uint32_t v = 0; v < vc; ++v) {
            auto wv = reader_->getSkinWeightsValues(mesh, v);
            auto jv = reader_->getSkinWeightsJointIndices(mesh, v);
            const size_t k = std::min<size_t>(wv.size(), mi);
            for (size_t j = 0; j < k; ++j) {
                wp[(size_t)v*mi + j] = wv[j];
                jp[(size_t)v*mi + j] = static_cast<std::int32_t>(jv[j]);
            }
        }
        return py::make_tuple(w, ji);
    }

    // blendshape targets
    std::uint16_t blendShapeTargetCount(std::uint16_t mesh) const {
        return reader_->getBlendShapeTargetCount(mesh);
    }
    std::uint16_t blendShapeChannelIndex(std::uint16_t mesh, std::uint16_t t) const {
        return reader_->getBlendShapeChannelIndex(mesh, t);
    }
    py::array_t<float> blendShapeTargetDeltas(std::uint16_t mesh, std::uint16_t t) const {
        return xyz_(reader_->getBlendShapeTargetDeltaXs(mesh, t),
                    reader_->getBlendShapeTargetDeltaYs(mesh, t),
                    reader_->getBlendShapeTargetDeltaZs(mesh, t));
    }
    py::array_t<std::uint32_t> blendShapeTargetVertexIndices(std::uint16_t mesh, std::uint16_t t) const {
        return view_to_array(reader_->getBlendShapeTargetVertexIndices(mesh, t));
    }

    // ---- RigLogic evaluation ----
    void setGUIControls(py::array_t<float, py::array::c_style | py::array::forcecast> values) {
        if (values.size() != reader_->getGUIControlCount()) {
            throw std::runtime_error("setGUIControls: expected " +
                std::to_string(reader_->getGUIControlCount()) + " values, got " +
                std::to_string(values.size()));
        }
        rigInstance_->setGUIControlValues(values.data());
    }
    void setRawControls(py::array_t<float, py::array::c_style | py::array::forcecast> values) {
        if (values.size() != reader_->getRawControlCount()) {
            throw std::runtime_error("setRawControls: expected " +
                std::to_string(reader_->getRawControlCount()) + " values, got " +
                std::to_string(values.size()));
        }
        rigInstance_->setRawControlValues(values.data());
    }
    void mapGUIToRaw() { rigLogic_->mapGUIToRawControls(rigInstance_); }
    void calculate() { rigLogic_->calculate(rigInstance_); }

    void setLOD(std::uint16_t lod) { rigInstance_->setLOD(lod); }
    std::uint16_t getLOD() const { return rigInstance_->getLOD(); }

    py::array_t<float> jointOutputs() const { return view_to_array(rigInstance_->getJointOutputs()); }
    py::array_t<float> blendShapeOutputs() const { return view_to_array(rigInstance_->getBlendShapeOutputs()); }
    py::array_t<float> animatedMapOutputs() const { return view_to_array(rigInstance_->getAnimatedMapOutputs()); }
    py::array_t<float> neutralJointValues() const { return view_to_array(rigLogic_->getNeutralJointValues()); }
    py::array_t<float> rawControlValues() const { return view_to_array(rigInstance_->getRawControlValues()); }

    std::uint32_t vertexPositionCount(std::uint16_t mesh) const {
        return reader_->getVertexPositionCount(mesh);
    }

    std::uint16_t jointGroupCount() const { return reader_->getJointGroupCount(); }
    py::array_t<std::uint16_t> jointGroupJointIndices(std::uint16_t jointGroupIndex) const {
        return view_to_array(reader_->getJointGroupJointIndices(jointGroupIndex));
    }
    py::array_t<std::uint16_t> jointGroupInputIndices(std::uint16_t jointGroupIndex) const {
        return view_to_array(reader_->getJointGroupInputIndices(jointGroupIndex));
    }
    py::array_t<std::uint16_t> jointGroupOutputIndices(std::uint16_t jointGroupIndex) const {
        return view_to_array(reader_->getJointGroupOutputIndices(jointGroupIndex));
    }
    py::array_t<std::uint16_t> jointGroupLODs(std::uint16_t jointGroupIndex) const {
        return view_to_array(reader_->getJointGroupLODs(jointGroupIndex));
    }

    std::uint16_t meshRegionCount(std::uint16_t meshIndex) const {
        return reader_->getMeshRegionCount(meshIndex);
    }
    std::string meshRegionName(std::uint16_t meshIndex, std::uint16_t regionIndex) const {
        return sv_to_string(reader_->getMeshRegionName(meshIndex, regionIndex));
    }
    py::array_t<std::uint16_t> neuralNetworkIndicesForMeshRegion(std::uint16_t meshIndex,
                                                                 std::uint16_t regionIndex) const {
        return view_to_array(reader_->getNeuralNetworkIndicesForMeshRegion(meshIndex, regionIndex));
    }

    // ---- Descriptor / Header ----
    std::uint16_t fileFormatGeneration() const { return reader_->getFileFormatGeneration(); }
    std::uint16_t fileFormatVersion() const { return reader_->getFileFormatVersion(); }
    std::string characterName() const { return sv_to_string(reader_->getName()); }
    int archetype() const { return static_cast<int>(reader_->getArchetype()); }
    int gender() const { return static_cast<int>(reader_->getGender()); }
    std::uint16_t age() const { return reader_->getAge(); }
    std::string dbName() const { return sv_to_string(reader_->getDBName()); }
    std::string dbComplexity() const { return sv_to_string(reader_->getDBComplexity()); }
    std::uint16_t dbMaxLOD() const { return reader_->getDBMaxLOD(); }
    int translationUnit() const { return static_cast<int>(reader_->getTranslationUnit()); }
    int rotationUnit() const { return static_cast<int>(reader_->getRotationUnit()); }

    py::dict metadata() const {
        py::dict out;
        for (std::uint32_t i = 0; i < reader_->getMetaDataCount(); ++i) {
            const auto key = sv_to_string(reader_->getMetaDataKey(i));
            const auto val = sv_to_string(reader_->getMetaDataValue(key.c_str()));
            out[py::str(key)] = py::str(val);
        }
        return out;
    }

    py::dict coordinateSystem() const {
        const auto cs = reader_->getCoordinateSystem();
        auto dir = [](dna::Direction d) {
            switch (d) {
                case dna::Direction::left: return "left";
                case dna::Direction::right: return "right";
                case dna::Direction::up: return "up";
                case dna::Direction::down: return "down";
                case dna::Direction::front: return "front";
                case dna::Direction::back: return "back";
                default: return "unknown";
            }
        };
        py::dict out;
        out["x"] = dir(cs.xAxis);
        out["y"] = dir(cs.yAxis);
        out["z"] = dir(cs.zAxis);
        return out;
    }

    // ---- Definition (LOD mappings) ----
    std::vector<int> jointIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getJointIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }
    std::vector<int> blendShapeChannelIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getBlendShapeChannelIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }
    std::vector<int> animatedMapIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getAnimatedMapIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }
    std::uint16_t meshBlendShapeChannelMappingCount() const {
        return reader_->getMeshBlendShapeChannelMappingCount();
    }
    py::dict meshBlendShapeChannelMapping(std::uint16_t index) const {
        const auto m = reader_->getMeshBlendShapeChannelMapping(index);
        py::dict out;
        out["mesh_index"] = m.meshIndex;
        out["blend_shape_channel_index"] = m.blendShapeChannelIndex;
        return out;
    }
    std::vector<int> meshBlendShapeChannelMappingIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getMeshBlendShapeChannelMappingIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }

    // ---- Behavior ----
    py::array_t<std::uint16_t> guiToRawInputIndices() const {
        return view_to_array(reader_->getGUIToRawInputIndices());
    }
    py::array_t<std::uint16_t> guiToRawOutputIndices() const {
        return view_to_array(reader_->getGUIToRawOutputIndices());
    }
    py::array_t<float> guiToRawFromValues() const {
        return view_to_array(reader_->getGUIToRawFromValues());
    }
    py::array_t<float> guiToRawToValues() const {
        return view_to_array(reader_->getGUIToRawToValues());
    }
    py::array_t<float> guiToRawSlopeValues() const {
        return view_to_array(reader_->getGUIToRawSlopeValues());
    }
    py::array_t<float> guiToRawCutValues() const {
        return view_to_array(reader_->getGUIToRawCutValues());
    }
    std::uint16_t psdCount() const { return reader_->getPSDCount(); }
    py::array_t<std::uint16_t> psdRowIndices() const {
        return view_to_array(reader_->getPSDRowIndices());
    }
    py::array_t<std::uint16_t> psdColumnIndices() const {
        return view_to_array(reader_->getPSDColumnIndices());
    }
    py::array_t<float> psdValues() const { return view_to_array(reader_->getPSDValues()); }
    std::uint16_t jointRowCount() const { return reader_->getJointRowCount(); }
    std::uint16_t jointColumnCount() const { return reader_->getJointColumnCount(); }
    py::array_t<std::uint16_t> jointVariableAttributeIndices(std::uint16_t lod) const {
        return view_to_array(reader_->getJointVariableAttributeIndices(lod));
    }
    py::array_t<float> jointGroupValues(std::uint16_t jointGroupIndex) const {
        return view_to_array(reader_->getJointGroupValues(jointGroupIndex));
    }
    py::array_t<std::uint16_t> blendShapeChannelLODs() const {
        return view_to_array(reader_->getBlendShapeChannelLODs());
    }
    py::array_t<std::uint16_t> blendShapeChannelInputIndices() const {
        return view_to_array(reader_->getBlendShapeChannelInputIndices());
    }
    py::array_t<std::uint16_t> blendShapeChannelOutputIndices() const {
        return view_to_array(reader_->getBlendShapeChannelOutputIndices());
    }
    py::array_t<std::uint16_t> animatedMapLODs() const {
        return view_to_array(reader_->getAnimatedMapLODs());
    }
    py::array_t<std::uint16_t> animatedMapInputIndices() const {
        return view_to_array(reader_->getAnimatedMapInputIndices());
    }
    py::array_t<std::uint16_t> animatedMapOutputIndices() const {
        return view_to_array(reader_->getAnimatedMapOutputIndices());
    }
    py::array_t<float> animatedMapFromValues() const {
        return view_to_array(reader_->getAnimatedMapFromValues());
    }
    py::array_t<float> animatedMapToValues() const {
        return view_to_array(reader_->getAnimatedMapToValues());
    }
    py::array_t<float> animatedMapSlopeValues() const {
        return view_to_array(reader_->getAnimatedMapSlopeValues());
    }
    py::array_t<float> animatedMapCutValues() const {
        return view_to_array(reader_->getAnimatedMapCutValues());
    }

    // ---- Machine Learned Behavior ----
    std::uint16_t mlControlCount() const { return reader_->getMLControlCount(); }
    std::vector<std::string> mlControlNames() const {
        std::vector<std::string> out;
        for (std::uint16_t i = 0; i < reader_->getMLControlCount(); ++i)
            out.push_back(sv_to_string(reader_->getMLControlName(i)));
        return out;
    }
    std::uint16_t neuralNetworkCount() const { return reader_->getNeuralNetworkCount(); }
    std::vector<int> neuralNetworkIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getNeuralNetworkIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }
    py::array_t<std::uint16_t> neuralNetworkInputIndices(std::uint16_t netIndex) const {
        return view_to_array(reader_->getNeuralNetworkInputIndices(netIndex));
    }
    py::array_t<std::uint16_t> neuralNetworkOutputIndices(std::uint16_t netIndex) const {
        return view_to_array(reader_->getNeuralNetworkOutputIndices(netIndex));
    }
    std::uint16_t neuralNetworkLayerCount(std::uint16_t netIndex) const {
        return reader_->getNeuralNetworkLayerCount(netIndex);
    }
    int neuralNetworkLayerActivationFunction(std::uint16_t netIndex, std::uint16_t layerIndex) const {
        return static_cast<int>(reader_->getNeuralNetworkLayerActivationFunction(netIndex, layerIndex));
    }
    py::array_t<float> neuralNetworkLayerActivationFunctionParameters(std::uint16_t netIndex,
                                                                      std::uint16_t layerIndex) const {
        return view_to_array(reader_->getNeuralNetworkLayerActivationFunctionParameters(netIndex, layerIndex));
    }
    py::array_t<float> neuralNetworkLayerBiases(std::uint16_t netIndex, std::uint16_t layerIndex) const {
        return view_to_array(reader_->getNeuralNetworkLayerBiases(netIndex, layerIndex));
    }
    py::array_t<float> neuralNetworkLayerWeights(std::uint16_t netIndex, std::uint16_t layerIndex) const {
        return view_to_array(reader_->getNeuralNetworkLayerWeights(netIndex, layerIndex));
    }

    // ---- RBF Behavior ----
    std::uint16_t rbfPoseCount() const { return reader_->getRBFPoseCount(); }
    std::string rbfPoseName(std::uint16_t poseIndex) const {
        return sv_to_string(reader_->getRBFPoseName(poseIndex));
    }
    std::uint16_t rbfPoseControlCount() const { return reader_->getRBFPoseControlCount(); }
    std::string rbfPoseControlName(std::uint16_t poseControlIndex) const {
        return sv_to_string(reader_->getRBFPoseControlName(poseControlIndex));
    }
    py::array_t<std::uint16_t> rbfPoseJointOutputIndices(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseJointOutputIndices(poseIndex));
    }
    py::array_t<std::uint16_t> rbfPoseBlendShapeChannelOutputIndices(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseBlendShapeChannelOutputIndices(poseIndex));
    }
    py::array_t<std::uint16_t> rbfPoseAnimatedMapOutputIndices(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseAnimatedMapOutputIndices(poseIndex));
    }
    py::array_t<float> rbfPoseJointOutputValues(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseJointOutputValues(poseIndex));
    }
    float rbfPoseScale(std::uint16_t poseIndex) const { return reader_->getRBFPoseScale(poseIndex); }
    py::array_t<std::uint16_t> rbfPoseInputControlIndices(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseInputControlIndices(poseIndex));
    }
    py::array_t<std::uint16_t> rbfPoseOutputControlIndices(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseOutputControlIndices(poseIndex));
    }
    py::array_t<float> rbfPoseOutputControlWeights(std::uint16_t poseIndex) const {
        return view_to_array(reader_->getRBFPoseOutputControlWeights(poseIndex));
    }
    std::uint16_t rbfSolverCount() const { return reader_->getRBFSolverCount(); }
    std::string rbfSolverName(std::uint16_t solverIndex) const {
        return sv_to_string(reader_->getRBFSolverName(solverIndex));
    }
    std::vector<int> rbfSolverIndicesForLOD(std::uint16_t lod) const {
        auto v = reader_->getRBFSolverIndicesForLOD(lod);
        return std::vector<int>(v.begin(), v.end());
    }
    py::array_t<std::uint16_t> rbfSolverRawControlIndices(std::uint16_t solverIndex) const {
        return view_to_array(reader_->getRBFSolverRawControlIndices(solverIndex));
    }
    py::array_t<std::uint16_t> rbfSolverPoseIndices(std::uint16_t solverIndex) const {
        return view_to_array(reader_->getRBFSolverPoseIndices(solverIndex));
    }
    py::array_t<float> rbfSolverRawControlValues(std::uint16_t solverIndex) const {
        return view_to_array(reader_->getRBFSolverRawControlValues(solverIndex));
    }
    float rbfSolverRadius(std::uint16_t solverIndex) const {
        return reader_->getRBFSolverRadius(solverIndex);
    }

    // joint -> influenced vertices for a mesh (sparse)
    py::list jointVertexInfluences(std::uint16_t mesh, float minWeight = 0.0f) const {
        const std::uint32_t vc = reader_->getVertexPositionCount(mesh);
        const std::uint16_t maxInf = reader_->getMaximumInfluencePerVertex(mesh);
        const std::uint16_t jc = reader_->getJointCount();
        std::vector<std::vector<py::dict>> perJoint(jc);
        for (std::uint32_t v = 0; v < vc; ++v) {
            auto wv = reader_->getSkinWeightsValues(mesh, v);
            auto jv = reader_->getSkinWeightsJointIndices(mesh, v);
            const size_t k = std::min<size_t>(wv.size(), maxInf);
            for (size_t j = 0; j < k; ++j) {
                const float wt = wv[j];
                if (wt <= minWeight) continue;
                const auto joint = jv[j];
                if (joint >= jc) continue;
                py::dict entry;
                entry["vertex_id"] = v;
                entry["weight"] = wt;
                perJoint[joint].push_back(std::move(entry));
            }
        }
        py::list out;
        for (std::uint16_t j = 0; j < jc; ++j) {
            py::dict jd;
            jd["joint_index"] = j;
            jd["joint_name"] = sv_to_string(reader_->getJointName(j));
            py::list verts;
            for (const auto& e : perJoint[j]) verts.append(e);
            jd["vertices"] = std::move(verts);
            out.append(std::move(jd));
        }
        return out;
    }

    int attrsPerJoint() const { return attrsPerJoint_; }

private:
    template <typename V>
    py::array_t<float> xyz_(const V& xs, const V& ys, const V& zs) const {
        const py::ssize_t n = static_cast<py::ssize_t>(xs.size());
        py::array_t<float> out({n, (py::ssize_t)3});
        auto* p = out.mutable_data();
        for (py::ssize_t i = 0; i < n; ++i) {
            p[i*3] = xs[i]; p[i*3+1] = ys[i]; p[i*3+2] = zs[i];
        }
        return out;
    }

    int attrsPerJoint_ = 9;
    pma::AlignedMemoryResource memRes_;
    trio::FileStream* stream_ = nullptr;
    dna::BinaryStreamReader* reader_ = nullptr;
    rl4::RigLogic* rigLogic_ = nullptr;
    rl4::RigInstance* rigInstance_ = nullptr;
};

PYBIND11_MODULE(riglogic, m) {
    m.doc() = "Standalone RigLogic/DNA (rl4) bindings for DNA 2.5";
    py::class_<Rig>(m, "Rig")
        .def(py::init<const std::string&, bool, bool, bool, bool, bool, bool, bool, bool>(),
             py::arg("dna_path"),
             py::arg("scalar") = true,
             py::arg("load_joints") = true,
             py::arg("load_blend_shapes") = true,
             py::arg("load_animated_maps") = true,
             py::arg("load_machine_learned_behavior") = true,
             py::arg("load_rbf_behavior") = true,
             py::arg("load_twist_swing_behavior") = true,
             py::arg("quaternions") = true)
        .def("attrs_per_joint", &Rig::attrsPerJoint)
        .def("lod_count", &Rig::lodCount)
        .def("gui_control_count", &Rig::guiControlCount)
        .def("raw_control_count", &Rig::rawControlCount)
        .def("joint_count", &Rig::jointCount)
        .def("blend_shape_channel_count", &Rig::blendShapeChannelCount)
        .def("animated_map_count", &Rig::animatedMapCount)
        .def("mesh_count", &Rig::meshCount)
        .def("gui_control_names", &Rig::guiControlNames)
        .def("raw_control_names", &Rig::rawControlNames)
        .def("joint_names", &Rig::jointNames)
        .def("blend_shape_channel_names", &Rig::blendShapeChannelNames)
        .def("animated_map_names", &Rig::animatedMapNames)
        .def("mesh_names", &Rig::meshNames)
        .def("joint_parent_indices", &Rig::jointParentIndices)
        .def("mesh_indices_for_lod", &Rig::meshIndicesForLOD, py::arg("lod"))
        .def("neutral_joint_translations", &Rig::neutralJointTranslations)
        .def("neutral_joint_rotations", &Rig::neutralJointRotations)
        .def("vertex_position_count", &Rig::vertexPositionCount, py::arg("mesh"))
        .def("joint_group_count", &Rig::jointGroupCount)
        .def("joint_group_joint_indices", &Rig::jointGroupJointIndices, py::arg("joint_group"))
        .def("joint_group_input_indices", &Rig::jointGroupInputIndices, py::arg("joint_group"))
        .def("joint_group_output_indices", &Rig::jointGroupOutputIndices, py::arg("joint_group"))
        .def("joint_group_lods", &Rig::jointGroupLODs, py::arg("joint_group"))
        .def("mesh_region_count", &Rig::meshRegionCount, py::arg("mesh"))
        .def("mesh_region_name", &Rig::meshRegionName, py::arg("mesh"), py::arg("region"))
        .def("neural_network_indices_for_mesh_region", &Rig::neuralNetworkIndicesForMeshRegion,
             py::arg("mesh"), py::arg("region"))
        .def("file_format_generation", &Rig::fileFormatGeneration)
        .def("file_format_version", &Rig::fileFormatVersion)
        .def("character_name", &Rig::characterName)
        .def("archetype", &Rig::archetype)
        .def("gender", &Rig::gender)
        .def("age", &Rig::age)
        .def("db_name", &Rig::dbName)
        .def("db_complexity", &Rig::dbComplexity)
        .def("db_max_lod", &Rig::dbMaxLOD)
        .def("translation_unit", &Rig::translationUnit)
        .def("rotation_unit", &Rig::rotationUnit)
        .def("metadata", &Rig::metadata)
        .def("coordinate_system", &Rig::coordinateSystem)
        .def("joint_indices_for_lod", &Rig::jointIndicesForLOD, py::arg("lod"))
        .def("blend_shape_channel_indices_for_lod", &Rig::blendShapeChannelIndicesForLOD, py::arg("lod"))
        .def("animated_map_indices_for_lod", &Rig::animatedMapIndicesForLOD, py::arg("lod"))
        .def("mesh_blend_shape_channel_mapping_count", &Rig::meshBlendShapeChannelMappingCount)
        .def("mesh_blend_shape_channel_mapping", &Rig::meshBlendShapeChannelMapping, py::arg("index"))
        .def("mesh_blend_shape_channel_mapping_indices_for_lod",
             &Rig::meshBlendShapeChannelMappingIndicesForLOD, py::arg("lod"))
        .def("gui_to_raw_input_indices", &Rig::guiToRawInputIndices)
        .def("gui_to_raw_output_indices", &Rig::guiToRawOutputIndices)
        .def("gui_to_raw_from_values", &Rig::guiToRawFromValues)
        .def("gui_to_raw_to_values", &Rig::guiToRawToValues)
        .def("gui_to_raw_slope_values", &Rig::guiToRawSlopeValues)
        .def("gui_to_raw_cut_values", &Rig::guiToRawCutValues)
        .def("psd_count", &Rig::psdCount)
        .def("psd_row_indices", &Rig::psdRowIndices)
        .def("psd_column_indices", &Rig::psdColumnIndices)
        .def("psd_values", &Rig::psdValues)
        .def("joint_row_count", &Rig::jointRowCount)
        .def("joint_column_count", &Rig::jointColumnCount)
        .def("joint_variable_attribute_indices", &Rig::jointVariableAttributeIndices, py::arg("lod"))
        .def("joint_group_values", &Rig::jointGroupValues, py::arg("joint_group"))
        .def("blend_shape_channel_lods", &Rig::blendShapeChannelLODs)
        .def("blend_shape_channel_input_indices", &Rig::blendShapeChannelInputIndices)
        .def("blend_shape_channel_output_indices", &Rig::blendShapeChannelOutputIndices)
        .def("animated_map_lods", &Rig::animatedMapLODs)
        .def("animated_map_input_indices", &Rig::animatedMapInputIndices)
        .def("animated_map_output_indices", &Rig::animatedMapOutputIndices)
        .def("animated_map_from_values", &Rig::animatedMapFromValues)
        .def("animated_map_to_values", &Rig::animatedMapToValues)
        .def("animated_map_slope_values", &Rig::animatedMapSlopeValues)
        .def("animated_map_cut_values", &Rig::animatedMapCutValues)
        .def("ml_control_count", &Rig::mlControlCount)
        .def("ml_control_names", &Rig::mlControlNames)
        .def("neural_network_count", &Rig::neuralNetworkCount)
        .def("neural_network_indices_for_lod", &Rig::neuralNetworkIndicesForLOD, py::arg("lod"))
        .def("neural_network_input_indices", &Rig::neuralNetworkInputIndices, py::arg("net_index"))
        .def("neural_network_output_indices", &Rig::neuralNetworkOutputIndices, py::arg("net_index"))
        .def("neural_network_layer_count", &Rig::neuralNetworkLayerCount, py::arg("net_index"))
        .def("neural_network_layer_activation_function", &Rig::neuralNetworkLayerActivationFunction,
             py::arg("net_index"), py::arg("layer_index"))
        .def("neural_network_layer_activation_function_parameters",
             &Rig::neuralNetworkLayerActivationFunctionParameters,
             py::arg("net_index"), py::arg("layer_index"))
        .def("neural_network_layer_biases", &Rig::neuralNetworkLayerBiases,
             py::arg("net_index"), py::arg("layer_index"))
        .def("neural_network_layer_weights", &Rig::neuralNetworkLayerWeights,
             py::arg("net_index"), py::arg("layer_index"))
        .def("rbf_pose_count", &Rig::rbfPoseCount)
        .def("rbf_pose_name", &Rig::rbfPoseName, py::arg("pose_index"))
        .def("rbf_pose_control_count", &Rig::rbfPoseControlCount)
        .def("rbf_pose_control_name", &Rig::rbfPoseControlName, py::arg("pose_control_index"))
        .def("rbf_pose_joint_output_indices", &Rig::rbfPoseJointOutputIndices, py::arg("pose_index"))
        .def("rbf_pose_blend_shape_channel_output_indices", &Rig::rbfPoseBlendShapeChannelOutputIndices,
             py::arg("pose_index"))
        .def("rbf_pose_animated_map_output_indices", &Rig::rbfPoseAnimatedMapOutputIndices, py::arg("pose_index"))
        .def("rbf_pose_joint_output_values", &Rig::rbfPoseJointOutputValues, py::arg("pose_index"))
        .def("rbf_pose_scale", &Rig::rbfPoseScale, py::arg("pose_index"))
        .def("rbf_pose_input_control_indices", &Rig::rbfPoseInputControlIndices, py::arg("pose_index"))
        .def("rbf_pose_output_control_indices", &Rig::rbfPoseOutputControlIndices, py::arg("pose_index"))
        .def("rbf_pose_output_control_weights", &Rig::rbfPoseOutputControlWeights, py::arg("pose_index"))
        .def("rbf_solver_count", &Rig::rbfSolverCount)
        .def("rbf_solver_name", &Rig::rbfSolverName, py::arg("solver_index"))
        .def("rbf_solver_indices_for_lod", &Rig::rbfSolverIndicesForLOD, py::arg("lod"))
        .def("rbf_solver_raw_control_indices", &Rig::rbfSolverRawControlIndices, py::arg("solver_index"))
        .def("rbf_solver_pose_indices", &Rig::rbfSolverPoseIndices, py::arg("solver_index"))
        .def("rbf_solver_raw_control_values", &Rig::rbfSolverRawControlValues, py::arg("solver_index"))
        .def("rbf_solver_radius", &Rig::rbfSolverRadius, py::arg("solver_index"))
        .def("joint_vertex_influences", &Rig::jointVertexInfluences,
             py::arg("mesh"), py::arg("min_weight") = 0.0f)
        .def("vertex_positions", &Rig::vertexPositions, py::arg("mesh"))
        .def("vertex_normals", &Rig::vertexNormals, py::arg("mesh"))
        .def("vertex_uvs", &Rig::vertexUVs, py::arg("mesh"))
        .def("layout_position_indices", &Rig::layoutPositionIndices, py::arg("mesh"))
        .def("layout_uv_indices", &Rig::layoutUVIndices, py::arg("mesh"))
        .def("layout_normal_indices", &Rig::layoutNormalIndices, py::arg("mesh"))
        .def("faces", &Rig::faces, py::arg("mesh"))
        .def("max_influence_per_vertex", &Rig::maxInfluencePerVertex, py::arg("mesh"))
        .def("skin_weights", &Rig::skinWeights, py::arg("mesh"))
        .def("blend_shape_target_count", &Rig::blendShapeTargetCount, py::arg("mesh"))
        .def("blend_shape_channel_index", &Rig::blendShapeChannelIndex, py::arg("mesh"), py::arg("target"))
        .def("blend_shape_target_deltas", &Rig::blendShapeTargetDeltas, py::arg("mesh"), py::arg("target"))
        .def("blend_shape_target_vertex_indices", &Rig::blendShapeTargetVertexIndices, py::arg("mesh"), py::arg("target"))
        .def("set_gui_controls", &Rig::setGUIControls, py::arg("values"))
        .def("set_raw_controls", &Rig::setRawControls, py::arg("values"))
        .def("map_gui_to_raw", &Rig::mapGUIToRaw)
        .def("calculate", &Rig::calculate)
        .def("set_lod", &Rig::setLOD, py::arg("lod"))
        .def("get_lod", &Rig::getLOD)
        .def("joint_outputs", &Rig::jointOutputs)
        .def("blend_shape_outputs", &Rig::blendShapeOutputs)
        .def("animated_map_outputs", &Rig::animatedMapOutputs)
        .def("neutral_joint_values", &Rig::neutralJointValues)
        .def("raw_control_values", &Rig::rawControlValues);
}
